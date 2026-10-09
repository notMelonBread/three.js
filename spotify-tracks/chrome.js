// 2D 版・3D 版で共通の外側 UI(右の menu 窓、キャプション、他方へのリンク)

const caption = document.getElementById("caption");
const menuList = document.getElementById("menu-list");
let menuLinks = new Map();

export function setCaption(track) {
  caption.replaceChildren();
  caption.classList.toggle("is-on", Boolean(track));
  for (const link of menuLinks.values()) link.classList.remove("is-focus");
  if (!track) return;
  const name = document.createElement("strong");
  name.textContent = `#${track.rank} ${track.name}`;
  caption.append(name, ` / ${track.artist}`);
  menuLinks.get(track)?.classList.add("is-focus");
}

// 右の menu 窓に上位曲を並べる。onPick を渡すと、ホバーでその曲をコラージュ側でも浮かせられる
export function renderMenu(tracks, { limit = 12, onPick } = {}) {
  if (!menuList) return;
  menuList.replaceChildren();
  menuLinks = new Map();
  const sorted = tracks.slice().sort((a, b) => a.rank - b.rank).slice(0, limit);
  for (const track of sorted) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = track.spotify_url || "#";
    a.target = "_blank";
    a.rel = "noopener";
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${String(track.rank).padStart(2, "0")}`;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = track.name;
    const artist = document.createElement("span");
    artist.className = "artist";
    artist.textContent = track.artist;
    name.append(artist);
    a.append(rank, name);
    if (onPick) {
      a.addEventListener("pointerenter", () => onPick(track));
      a.addEventListener("pointerleave", () => onPick(null));
    }
    li.append(a);
    menuList.append(li);
    menuLinks.set(track, a);
  }
}

export function hideLoading() {
  document.getElementById("loading")?.classList.add("is-hidden");
}
