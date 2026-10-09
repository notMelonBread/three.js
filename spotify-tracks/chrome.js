// 2D 版・3D 版で共通の外側 UI(キャプションとローディング)

const caption = document.getElementById("caption");

export function setCaption(track) {
  caption.replaceChildren();
  caption.classList.toggle("is-on", Boolean(track));
  if (!track) return;
  const name = document.createElement("strong");
  name.textContent = `#${track.rank} ${track.name}`;
  caption.append(name, ` / ${track.artist}`);
}

export function hideLoading() {
  document.getElementById("loading")?.classList.add("is-hidden");
}
