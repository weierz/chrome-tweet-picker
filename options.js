const DEFAULTS = { shareMode: 'image' };
const form = document.getElementById('form');
const saved = document.getElementById('saved');

chrome.storage.sync.get(DEFAULTS, ({ shareMode }) => {
  const input = form.querySelector(`input[value="${shareMode}"]`) || form.querySelector('input');
  input.checked = true;
});

form.addEventListener('change', (e) => {
  chrome.storage.sync.set({ shareMode: e.target.value }, () => {
    saved.textContent = 'Saved';
    clearTimeout(saved.__t);
    saved.__t = setTimeout(() => (saved.textContent = ''), 1200);
  });
});
