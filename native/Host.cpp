// SPDX-License-Identifier: AGPL-3.0-only
#include <juce_audio_utils/juce_audio_utils.h>
#include <windows.h>
#include <io.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

using namespace juce;

class EditorWindow final : public DocumentWindow
{
public:
    EditorWindow (const String& title, AudioProcessorEditor* editor)
        : DocumentWindow (title, Colours::darkgrey, DocumentWindow::closeButton)
    {
        setUsingNativeTitleBar (true);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);
        centreWithSize (getWidth(), getHeight());
        setVisible (true);
    }
    void closeButtonPressed() override { setVisible (false); }
};

struct NoteEvent { int64 frame; MidiMessage message; };

class Host final : public JUCEApplication, private AudioIODeviceCallback
{
public:
    const String getApplicationName() override { return "Liupu VST Host"; }
    const String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const String&) override
    {
        // Plug-ins sometimes print to stdout. Keep the protocol on a duplicated pipe.
        DuplicateHandle (GetCurrentProcess(), GetStdHandle (STD_OUTPUT_HANDLE),
                         GetCurrentProcess(), &protocolHandle, 0, FALSE, DUPLICATE_SAME_ACCESS);
        _dup2 (_fileno (stderr), _fileno (stdout));
        SetStdHandle (STD_OUTPUT_HANDLE, GetStdHandle (STD_ERROR_HANDLE));
        formats.addFormat (std::make_unique<VST3PluginFormat>());
        deviceError = devices.initialise (0, 2, nullptr, true);
        devices.addAudioCallback (this);
        reader = std::thread ([this]
        {
            std::string line;
            while (std::getline (std::cin, line))
            {
                if (line.size() > 8 * 1024 * 1024)
                    continue;
                auto message = JSON::parse (String::fromUTF8 (line.data(), (int) line.size()));
                MessageManager::callAsync ([this, message] { command (message); });
            }
            MessageManager::callAsync ([this] { quit(); });
        });
    }

    void shutdown() override
    {
        chooser.reset();
        devices.removeAudioCallback (this);
        editor.reset();
        if (plugin != nullptr) plugin->releaseResources();
        plugin.reset();
        devices.closeAudioDevice();
        // EOF normally wakes the reader; CancelSynchronousIo also handles OS shutdown.
        if (reader.joinable())
        {
            CancelSynchronousIo ((HANDLE) reader.native_handle());
            reader.join();
        }
        if (protocolHandle != nullptr) CloseHandle (protocolHandle);
    }

    void systemRequestedQuit() override { quit(); }

private:
    AudioDeviceManager devices;
    AudioPluginFormatManager formats;
    std::unique_ptr<AudioPluginInstance> plugin;
    std::unique_ptr<EditorWindow> editor;
    std::unique_ptr<FileChooser> chooser;
    std::thread reader;
    HANDLE protocolHandle = nullptr;
    std::mutex audioMutex;
    AudioBuffer<float> work;
    MidiBuffer midi;
    std::vector<NoteEvent> events;
    size_t nextEvent = 0;
    std::atomic<int64> clockFrames { 0 };
    std::atomic<bool> playing { false };
    std::atomic<float> outputPeak { 0 };
    int64 songStart = 0;
    double sampleRate = 44100;
    int blockSize = 512, channels = 2;
    float volume = 0.5f;
    bool panic = false, loading = false;
    String deviceError, pluginPath;

    void respond (const var& id, bool ok, const String& error = {}, double startDelay = 0)
    {
        auto* object = new DynamicObject();
        object->setProperty ("id", id);
        object->setProperty ("ok", ok);
        object->setProperty ("loaded", plugin != nullptr);
        object->setProperty ("name", plugin != nullptr ? plugin->getName() : String());
        object->setProperty ("editorOpen", editor != nullptr && editor->isVisible());
        object->setProperty ("hasEditor", plugin != nullptr && plugin->hasEditor());
        object->setProperty ("playing", playing.load());
        object->setProperty ("sampleRate", sampleRate);
        object->setProperty ("blockSize", blockSize);
        object->setProperty ("outputPeak", outputPeak.load());
        object->setProperty ("startDelay", startDelay);
        object->setProperty ("device", devices.getCurrentAudioDevice() != nullptr
                                      ? devices.getCurrentAudioDevice()->getName() : String());
        object->setProperty ("error", error.isNotEmpty() ? error : deviceError);
        auto text = JSON::toString (var (object), true) + "\n";
        const auto* bytes = text.toRawUTF8();
        DWORD written = 0;
        WriteFile (protocolHandle, bytes, (DWORD) text.getNumBytesAsUTF8(), &written, nullptr);
    }

    void stopNotes()
    {
        std::lock_guard<std::mutex> lock (audioMutex);
        events.clear(); nextEvent = 0; playing = false; panic = true;
    }

    void command (const var& request)
    {
        const var id = request["id"];
        const auto action = request["action"].toString();
        if (! request.isObject()) { respond (id, false, "Invalid JSON object"); return; }
        if (action == "status") { respond (id, true); return; }
        if (action == "stop") { stopNotes(); respond (id, true); return; }
        if (action == "volume")
        {
            const auto value = (double) request["volume"];
            if (! std::isfinite (value) || value < 0 || value > 1)
            { respond (id, false, "Volume must be between 0 and 1"); return; }
            { std::lock_guard<std::mutex> lock (audioMutex); volume = (float) value; }
            respond (id, true); return;
        }
        if (loading) { respond (id, false, "A plug-in selection or load is already in progress"); return; }
        if (action == "load")
        {
            stopNotes();
            if (request["path"].toString().isNotEmpty())
            { load (id, File (request["path"].toString())); return; }
            loading = true;
            // JUCE's chooser can select both a .vst3 bundle directory and a DLL-style .vst3.
            LocalisedStrings::setCurrentMappings (new LocalisedStrings (request["chooserTranslations"].toString(), false));
            const auto title = request["chooserTitle"].toString();
            chooser = std::make_unique<FileChooser> (title.isNotEmpty() ? title : "Select a VST3 instrument (.vst3 file or folder)",
                          File ("C:\\Program Files\\Common Files\\VST3"), "*.vst3", false);
            chooser->launchAsync (FileBrowserComponent::openMode | FileBrowserComponent::canSelectFiles
                                  | FileBrowserComponent::canSelectDirectories,
                [this, id] (const FileChooser& result)
                {
                    const auto file = result.getResult();
                    loading = false;
                    if (file == File()) respond (id, false, "Selection cancelled");
                    else load (id, file);
                    chooser.reset();
                });
            return;
        }
        if (action == "unload")
        {
            stopNotes(); editor.reset();
            { std::lock_guard<std::mutex> lock (audioMutex);
              if (plugin != nullptr) plugin->releaseResources();
              plugin.reset(); pluginPath.clear(); }
            respond (id, true); return;
        }
        if (action == "showEditor")
        {
            if (plugin == nullptr) { respond (id, false, "Load an instrument first"); return; }
            if (editor == nullptr)
            {
                auto* view = plugin->createEditorIfNeeded();
                if (view == nullptr) { respond (id, false, "This plug-in has no native editor"); return; }
                editor = std::make_unique<EditorWindow> (plugin->getName(), view);
            }
            editor->setVisible (true);
            // A hidden-console launch may override the first Win32 ShowWindow call.
            if (auto* peer = editor->getPeer()) peer->setVisible (true);
            editor->toFront (true);
            respond (id, true); return;
        }
        if (action == "play") { play (id, request); return; }
        respond (id, false, "Unknown action");
    }

    void load (const var& id, const File& file)
    {
        if (! file.exists() || ! file.hasFileExtension ("vst3"))
        { respond (id, false, "Select an existing .vst3 file or bundle"); return; }
        if (deviceError.isNotEmpty()) { respond (id, false, deviceError); return; }
        loading = true;
        OwnedArray<PluginDescription> descriptions;
        formats.getFormat (0)->findAllTypesForFile (descriptions, file.getFullPathName());
        auto found = std::find_if (descriptions.begin(), descriptions.end(),
                                  [] (auto* description) { return description->isInstrument; });
        if (found == descriptions.end())
        { loading = false; respond (id, false, "No VST3 instrument was found in this file"); return; }
        const auto path = file.getFullPathName();
        formats.createPluginInstanceAsync (**found, sampleRate, blockSize,
            [this, id, path] (std::unique_ptr<AudioPluginInstance> instance, const String& error)
            {
                loading = false;
                if (instance == nullptr) { respond (id, false, error); return; }
                instance->enableAllBuses();
                auto layout = instance->getBusesLayout();
                for (auto& bus : layout.inputBuses) bus = AudioChannelSet::disabled();
                for (int i = 0; i < layout.outputBuses.size(); ++i)
                    layout.outputBuses.getReference (i) = i == 0 ? AudioChannelSet::stereo() : AudioChannelSet::disabled();
                if (! instance->setBusesLayout (layout))
                {
                    if (! layout.outputBuses.isEmpty()) layout.outputBuses.getReference (0) = AudioChannelSet::mono();
                    instance->setBusesLayout (layout);
                }
                if (instance->getTotalNumOutputChannels() == 0 || instance->getTotalNumOutputChannels() > 64)
                { respond (id, false, "This instrument has no supported audio output"); return; }
                instance->setRateAndBufferSizeDetails (sampleRate, blockSize);
                instance->prepareToPlay (sampleRate, blockSize);
                editor.reset();
                { std::lock_guard<std::mutex> lock (audioMutex);
                  if (plugin != nullptr) plugin->releaseResources();
                  plugin = std::move (instance); pluginPath = path;
                  channels = jmax (2, jmax (plugin->getTotalNumInputChannels(), plugin->getTotalNumOutputChannels()));
                  work.setSize (channels, blockSize); panic = true; outputPeak = 0; }
                respond (id, true);
            });
    }

    void play (const var& id, const var& request)
    {
        if (plugin == nullptr) { respond (id, false, "Load an instrument first"); return; }
        auto* notes = request["events"].getArray();
        if (notes == nullptr || notes->size() > 60000)
        { respond (id, false, "Expected at most 60000 note events"); return; }
        auto delay = request.hasProperty ("startDelay") ? (double) request["startDelay"] : 0.15;
        if (! std::isfinite (delay) || delay < 0.05 || delay > 2)
        { respond (id, false, "startDelay must be between 0.05 and 2 seconds"); return; }
        const auto requestedVolume = request.hasProperty ("volume") ? (double) request["volume"] : volume;
        if (! std::isfinite (requestedVolume) || requestedVolume < 0 || requestedVolume > 1)
        { respond (id, false, "Volume must be between 0 and 1"); return; }
        std::vector<NoteEvent> next;
        next.reserve ((size_t) notes->size() * 2);
        for (const auto& note : *notes)
        {
            const auto start = (double) note["start"], end = (double) note["end"];
            const auto pitch = (int) note["pitch"];
            const auto rawVelocity = note.hasProperty ("velocity") ? (double) note["velocity"] : 95.0;
            const auto velocity = rawVelocity / 127.0;
            if (! std::isfinite (start) || ! std::isfinite (end) || ! std::isfinite (velocity)
                || start < 0 || end <= start || end > 43200 || pitch < 0 || pitch > 127
                || velocity <= 0 || velocity > 1 || rawVelocity != std::floor (rawVelocity))
            { respond (id, false, "Invalid note timing, pitch or velocity"); return; }
            next.push_back ({ (int64) std::llround (start * sampleRate), MidiMessage::noteOn (1, pitch, (float) velocity) });
            next.push_back ({ (int64) std::llround (end * sampleRate), MidiMessage::noteOff (1, pitch) });
        }
        std::stable_sort (next.begin(), next.end(), [] (const auto& a, const auto& b)
        { return a.frame != b.frame ? a.frame < b.frame : a.message.isNoteOff() && ! b.message.isNoteOff(); });
        { std::lock_guard<std::mutex> lock (audioMutex);
          events = std::move (next); nextEvent = 0;
          songStart = clockFrames.load() + (int64) std::llround (delay * sampleRate);
          panic = true; playing = ! events.empty(); outputPeak = 0; volume = (float) requestedVolume;
          midi.ensureSize ((size_t) jmax (4096, notes->size() * 16)); }
        respond (id, true, {}, delay);
    }

    void audioDeviceAboutToStart (AudioIODevice* device) override
    {
        std::lock_guard<std::mutex> lock (audioMutex);
        sampleRate = device->getCurrentSampleRate();
        blockSize = device->getCurrentBufferSizeSamples();
        work.setSize (channels, blockSize); midi.ensureSize (65536);
        if (plugin != nullptr)
        { plugin->releaseResources(); plugin->setRateAndBufferSizeDetails (sampleRate, blockSize); plugin->prepareToPlay (sampleRate, blockSize); }
        events.clear(); nextEvent = 0; playing = false; panic = true;
    }

    void audioDeviceStopped() override
    {
        std::lock_guard<std::mutex> lock (audioMutex);
        playing = false;
        if (plugin != nullptr) plugin->releaseResources();
    }

    void audioDeviceIOCallbackWithContext (const float* const*, int, float* const* output,
        int numOutputs, int count, const AudioIODeviceCallbackContext&) override
    {
        const auto frame = clockFrames.fetch_add (count);
        for (int c = 0; c < numOutputs; ++c) if (output[c] != nullptr) FloatVectorOperations::clear (output[c], count);
        std::unique_lock<std::mutex> lock (audioMutex, std::try_to_lock);
        if (! lock || plugin == nullptr || count > work.getNumSamples()) return;
        AudioBuffer<float> block (work.getArrayOfWritePointers(), channels, count);
        block.clear(); midi.clear();
        if (panic)
        {
            for (int c = 1; c <= 16; ++c)
            { midi.addEvent (MidiMessage::controllerEvent (c, 64, 0), 0);
              midi.addEvent (MidiMessage::allNotesOff (c), 0);
              midi.addEvent (MidiMessage::allSoundOff (c), 0); }
            panic = false;
        }
        if (playing)
        {
            while (nextEvent < events.size() && songStart + events[nextEvent].frame < frame + count)
            {
                const auto& event = events[nextEvent++];
                midi.addEvent (event.message, (int) jlimit<int64> (0, count - 1, songStart + event.frame - frame));
            }
            if (nextEvent == events.size()) playing = false;
        }
        plugin->processBlock (block, midi);
        const auto outputs = plugin->getTotalNumOutputChannels();
        float peak = outputPeak.load();
        for (int c = 0; c < numOutputs; ++c)
        {
            if (output[c] == nullptr) continue;
            const auto* data = block.getReadPointer (jmin (c, outputs - 1));
            for (int i = 0; i < count; ++i)
            {
                const auto value = data[i] * volume;
                output[c][i] = std::isfinite (value) ? jlimit (-1.0f, 1.0f, value) : 0;
                peak = jmax (peak, std::abs (output[c][i]));
            }
        }
        outputPeak = peak;
    }
};

START_JUCE_APPLICATION (Host)
