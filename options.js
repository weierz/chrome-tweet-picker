const DEFAULTS = { autoLike: false, autoBookmark: false, translate: false, autoExpand: false };
const forms = [...document.forms];

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const [k, v] of Object.entries(s)) {
    for (const f of forms) if (f.elements[k]) f.elements[k].checked = !!v;
  }
});

for (const f of forms) {
  f.addEventListener('change', (e) => {
    chrome.storage.sync.set({ [e.target.name]: e.target.checked });
  });
}
