const DEFAULTS = { autoLike: false, autoBookmark: false, translate: false };
const form = document.getElementById('form');

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const [k, v] of Object.entries(s)) {
    const input = form.elements[k];
    if (input) input.checked = !!v;
  }
});

form.addEventListener('change', (e) => {
  chrome.storage.sync.set({ [e.target.name]: e.target.checked });
});
