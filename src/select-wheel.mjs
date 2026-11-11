// Delegate so controls created by the studio and effect library behave alike.
export function bindSelectWheel(root) {
  let lastSelect, direction = 0, total = 0, lastEvent = -Infinity, lastChange = -Infinity;
  root.addEventListener('wheel', event => {
    const select = event.target.closest?.('select');
    if (!select || select.multiple || select.size > 1 || select.matches(':disabled') ||
        event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = event.timeStamp, sign = Math.sign(event.deltaY);
    if (select !== lastSelect || sign !== direction || now - lastEvent > 250) {
      total = 0; lastChange = -Infinity;
    }
    lastSelect = select; direction = sign; lastEvent = now;
    total += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? select.clientHeight : 1);
    if (Math.abs(total) < 40 || now - lastChange < 80) return;
    total = 0; lastChange = now;
    const options = [...select.options];
    for (let index = select.selectedIndex + sign; index >= 0 && index < options.length; index += sign) {
      const option = options[index];
      if (option.matches(':disabled') || option.closest('[hidden]')) continue;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
  }, { passive: false });
}
