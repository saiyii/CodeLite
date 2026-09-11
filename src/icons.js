// Tiny hand-written stroke icon set (16x16, currentColor) so the UI doesn't
// depend on an icon font/library just to look crisp.
const wrap = (paths, viewBox = "0 0 16 16") =>
  `<svg viewBox="${viewBox}" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const icons = {
  folder: wrap('<path d="M1.5 3.5h4l1.3 1.6H14.5v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z"/>'),
  folderOpen: wrap(
    '<path d="M1.5 4.2h4l1.3 1.6h6.2a1 1 0 0 1 .97 1.24l-1.2 5a1 1 0 0 1-.97.76H2.5a1 1 0 0 1-1-1v-7.6z"/>'
  ),
  file: wrap(
    '<path d="M4 1.5h5l3 3v9.2a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.3a.8.8 0 0 1 .8-.8z"/><path d="M9 1.5v3h3"/>'
  ),
  save: wrap(
    '<path d="M2.5 2h8l3 3v8.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5V2.5a.5.5 0 0 1 .5-.5z"/><path d="M4.5 2v3.5h5V2"/><path d="M4.7 9.2h6.6v4.8H4.7z"/>'
  ),
  play: wrap('<path d="M3.5 2.2v11.6a.7.7 0 0 0 1.07.6l9.2-5.8a.7.7 0 0 0 0-1.2l-9.2-5.8a.7.7 0 0 0-1.07.6z"/>'),
  stop: wrap('<rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.4"/>'),
  gear: wrap(
    '<circle cx="8" cy="8" r="2.3"/><path d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.4 3.6l-1.13 1.13M4.73 11.27L3.6 12.4M12.4 12.4l-1.13-1.13M4.73 4.73L3.6 3.6"/>'
  ),
  sun: wrap(
    '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.6v1.4M8 13v1.4M14.4 8H13M3 8H1.6M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1"/>'
  ),
  moon: wrap('<path d="M13.2 9.6A5.6 5.6 0 1 1 6.4 2.8a4.5 4.5 0 0 0 6.8 6.8z"/>'),
  close: wrap('<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>'),
  chevron: wrap('<path d="M5.5 3.5l5 4.5-5 4.5"/>'),
};

export function iconEl(name, extraClass = "") {
  return `<span class="i ${extraClass}">${icons[name] || ""}</span>`;
}
