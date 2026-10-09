// 2D 版・3D 版で共通の外側 UI(キャプション、ページ送り、ローディング)

// キャプション要素を指定して書く(ページごとに 1 つある)
export function setCaption(track, caption = document.getElementById("caption")) {
  if (!caption) return;
  caption.replaceChildren();
  caption.classList.toggle("is-on", Boolean(track));
  if (!track) return;
  const name = document.createElement("strong");
  name.textContent = `#${track.rank} ${track.name}`;
  caption.append(name, ` / ${track.artist}`);
}

// 画面右の丸いページ送り。onSelect(index) で飛ぶ。setCurrent(index) で現在位置を更新
export function createPager(labels, onSelect) {
  let pager = document.getElementById("pager");
  if (!pager) {
    pager = document.createElement("ul");
    pager.id = "pager";
    pager.className = "pager";
    document.body.append(pager);
  }
  pager.replaceChildren();
  pager.hidden = labels.length <= 1;
  const buttons = labels.map((label, i) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => onSelect(i));
    li.append(button);
    pager.append(li);
    return button;
  });
  return {
    setCurrent(index) {
      buttons.forEach((b, i) => b.classList.toggle("is-current", i === index));
    },
  };
}

export function hideLoading() {
  document.getElementById("loading")?.classList.add("is-hidden");
}
