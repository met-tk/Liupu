cmake_minimum_required(VERSION 3.22)
project(LiupuVSTHost VERSION 0.1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Keep the standalone host runnable without installing the MSVC redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
if(NOT WIN32)
  message(FATAL_ERROR "This first host implementation supports Windows x64 only.")
endif()
if(NOT DEFINED JUCE_SOURCE_DIR)
  set(JUCE_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.deps/JUCE-29396c22c93392d6738e021b83196283d6e4d850")
endif()
add_subdirectory("${JUCE_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/juce" EXCLUDE_FROM_ALL)
juce_add_console_app(LiupuVSTHost PRODUCT_NAME "Liupu VST Host")
target_sources(LiupuVSTHost PRIVATE Host.cpp)
target_compile_definitions(LiupuVSTHost PRIVATE
  JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_VST=0 JUCE_PLUGINHOST_AU=0 JUCE_PLUGINHOST_LV2=0
  JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=0
  JUCE_ASIO=0 JUCE_WASAPI=1 JUCE_DIRECTSOUND=1
  NOMINMAX WIN32_LEAN_AND_MEAN)
target_link_libraries(LiupuVSTHost PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
if(MSVC)
  target_compile_options(LiupuVSTHost PRIVATE /utf-8 /bigobj)
endif()
