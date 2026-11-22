import "./remote-folder-picker.css";

type Folder = { name: string; path: string };
type Listing = {
  current: string;
  parent: string | null;
  roots: string[];
  shortcuts?: Folder[];
  breadcrumbs: Folder[];
  folders: Folder[];
  truncated: boolean;
};

const RECENTS_KEY = "tcode.recentProjectDirs";
const LAST_KEY = "tcode.lastProjectDir";
const icon = {
  folder: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
  search: '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>',
  right: '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  close: '<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

function getRecents(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter((v): v is string => typeof v === "string" && v.length < 1024).slice(0, 6)
      : [];
  } catch { return []; }
}

function remember(path: string): void {
  try {
    localStorage.setItem(LAST_KEY, path);
    localStorage.setItem(RECENTS_KEY, JSON.stringify([path, ...getRecents().filter((x) => x !== path)].slice(0, 6)));
  } catch {}
}

/** The directory browser is remote: no mobile file-system permission is requested. */
export function openRemoteFolderPicker(): Promise<string | null> {
  return new Promise((finish) => {
    const oldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const mask = document.createElement("div");
    mask.className = "tcode-fp-mask";
    mask.innerHTML = `
      <aside class="tcode-fp" role="dialog" aria-modal="true" aria-labelledby="tcode-fp-title">
        <header class="tcode-fp-header">
          <div class="tcode-fp-top-icon">${icon.folder}</div>
          <div class="tcode-fp-heading"><h2 id="tcode-fp-title">選擇專案資料夾</h2>
            <p>選擇執行 TCode 的電腦上的資料夾</p></div>
          <button type="button" class="tcode-fp-iconbtn" data-action="close" aria-label="關閉">${icon.close}</button>
        </header>
        <div class="tcode-fp-scroll">
          <section class="tcode-fp-nav" aria-label="快捷位置">
            <div class="tcode-fp-sectionhead">快捷位置</div>
            <div class="tcode-fp-shortcuts"></div>
            <div class="tcode-fp-drives" data-id="drives" hidden></div>
          </section>
          <nav class="tcode-fp-breadcrumb" aria-label="資料夾路徑"></nav>
          <div class="tcode-fp-toolbar">
            <label class="tcode-fp-searchwrap">${icon.search}
              <input class="tcode-fp-input tcode-fp-search" data-id="search" type="search" placeholder="搜尋這一層" aria-label="搜尋目前資料夾">
            </label>
            <button type="button" class="tcode-fp-toolbutton" data-action="path" aria-expanded="false">路徑</button>
            <button type="button" class="tcode-fp-toolbutton" data-action="new">＋ 新增</button>
          </div>
          <form class="tcode-fp-pathform" data-id="pathform" hidden>
            <input class="tcode-fp-input" data-id="address" type="text" spellcheck="false" autocomplete="off" aria-label="手動輸入完整路徑" placeholder="C:\\Projects">
            <button type="submit" class="tcode-fp-toolbutton">前往</button>
          </form>
          <form class="tcode-fp-create" data-id="create-form" hidden>
            <h3>在目前位置建立資料夾</h3>
            <div class="tcode-fp-create-line">
              <input class="tcode-fp-input" data-id="new-name" maxlength="120" aria-label="新資料夾名稱" placeholder="輸入資料夾名稱" autocomplete="off" required>
              <button type="button" data-action="new-cancel">取消</button>
              <button type="submit" data-action="new-confirm">建立</button>
            </div>
          </form>
          <div class="tcode-fp-status" role="alert" data-id="error"></div>
          <div class="tcode-fp-list-title"><span>資料夾</span><span data-id="count"></span></div>
          <div class="tcode-fp-list" data-id="list" role="list"></div>
        </div>
        <footer class="tcode-fp-footer">
          <div class="tcode-fp-location"><span>目前位置</span><strong data-id="selected">—</strong></div>
          <div class="tcode-fp-actions">
            <button type="button" data-action="cancel">取消</button>
            <button type="button" class="tcode-fp-primary" data-action="choose" disabled>選擇此資料夾</button>
          </div>
        </footer>
      </aside>`;
    document.body.append(mask);
    const el = <T extends HTMLElement>(selector: string): T => {
      const node = mask.querySelector<T>(selector);
      if (!node) throw new Error("TCode folder picker element missing: " + selector);
      return node;
    };
    const list = el<HTMLDivElement>('[data-id="list"]');
    const crumbs = el<HTMLElement>(".tcode-fp-breadcrumb");
    const shortcuts = el<HTMLElement>(".tcode-fp-shortcuts");
    const drives = el<HTMLElement>('[data-id="drives"]');
    const search = el<HTMLInputElement>('[data-id="search"]');
    const address = el<HTMLInputElement>('[data-id="address"]');
    const pathForm = el<HTMLFormElement>('[data-id="pathform"]');
    const pathButton = el<HTMLButtonElement>('[data-action="path"]');
    const createForm = el<HTMLFormElement>('[data-id="create-form"]');
    const createName = el<HTMLInputElement>('[data-id="new-name"]');
    const createConfirm = el<HTMLButtonElement>('[data-action="new-confirm"]');
    const createButton = el<HTMLButtonElement>('[data-action="new"]');
    const choose = el<HTMLButtonElement>('[data-action="choose"]');
    const count = el<HTMLElement>('[data-id="count"]');
    const selected = el<HTMLElement>('[data-id="selected"]');
    const error = el<HTMLElement>('[data-id="error"]');

    let data: Listing | null = null;
    let creating = false;
    let sequence = 0;
    let closed = false;

    function close(value: string | null): void {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = oldOverflow;
      mask.remove();
      oldFocus?.focus();
      finish(value);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        // The inline editor closes before the entire picker.
        if (!createForm.hidden) { hideCreate(); return; }
        close(null);
      }
      if (event.key === "Tab") {
        const focusable = [...mask.querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden]),input:not(:disabled):not([hidden])')]
          .filter((element) => element.offsetParent !== null);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && first && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && last && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    mask.addEventListener("click", (event) => { if (event.target === mask) close(null); });
    el<HTMLButtonElement>('[data-action="close"]').onclick = () => close(null);
    el<HTMLButtonElement>('[data-action="cancel"]').onclick = () => close(null);
    el<HTMLButtonElement>('[data-action="new-cancel"]').onclick = () => hideCreate();

    function hideCreate(): void {
      createForm.hidden = true;
      createName.value = "";
      createButton.focus();
    }
    function nav(name: string, target: string, container: HTMLElement, kind: "chip" | "crumb" = "chip"): void {
      const button = document.createElement("button");
      button.type = "button";
      button.className = kind === "chip" ? "tcode-fp-chip" : "";
      button.textContent = name;
      button.title = target;
      if (kind === "chip") button.setAttribute("aria-current", String(target === data?.current));
      button.onclick = () => { void load(target); };
      container.append(button);
    }
    function renderList(): void {
      list.replaceChildren();
      if (!data) return;
      const term = search.value.trim().toLocaleLowerCase();
      const folders = data.folders.filter(({ name }) => name.toLocaleLowerCase().includes(term));
      count.textContent = term ? String(folders.length) + " 筆結果" : String(data.folders.length) + (data.truncated ? "+" : "") + " 個";
      if (!folders.length) {
        const empty = document.createElement("div");
        empty.className = "tcode-fp-empty";
        const heading = document.createElement("strong");
        heading.textContent = term ? "找不到符合的資料夾" : "這裡還沒有子資料夾";
        const hint = document.createElement("span");
        hint.textContent = term ? "可調整搜尋文字" : "可以在目前位置新增資料夾";
        empty.append(heading, hint);
        list.append(empty);
        return;
      }
      for (const folder of folders) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "tcode-fp-row";
        row.setAttribute("role", "listitem");
        row.title = folder.path;
        const glyph = document.createElement("span");
        glyph.className = "tcode-fp-foldericon";
        glyph.innerHTML = icon.folder;
        const name = document.createElement("span");
        name.className = "tcode-fp-row-label";
        name.textContent = folder.name;
        const arrow = document.createElement("span");
        arrow.className = "tcode-fp-chevron";
        arrow.innerHTML = icon.right;
        row.append(glyph, name, arrow);
        row.onclick = () => { void load(folder.path); };
        list.append(row);
      }
      if (data.truncated) {
        const hint = document.createElement("div");
        hint.className = "tcode-fp-empty";
        hint.textContent = "資料夾數量很多，請使用路徑輸入快速前往。";
        list.append(hint);
      }
    }
    function renderNav(): void {
      if (!data) return;
      shortcuts.replaceChildren();
      for (const item of data.shortcuts ?? []) nav(item.name, item.path, shortcuts);
      const recent = getRecents()[0];
      if (recent && recent !== data.current) nav("最近使用", recent, shortcuts);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "tcode-fp-chip";
      toggle.textContent = "磁碟機";
      toggle.setAttribute("aria-expanded", String(!drives.hidden));
      toggle.onclick = () => {
        drives.hidden = !drives.hidden;
        toggle.setAttribute("aria-expanded", String(!drives.hidden));
      };
      shortcuts.append(toggle);
      drives.replaceChildren();
      for (const drive of data.roots) nav(drive, drive, drives);
      crumbs.replaceChildren();
      if (data.parent) nav("↑", data.parent, crumbs, "crumb");
      for (const [index, item] of data.breadcrumbs.entries()) {
        if (index > 0) {
          const sep = document.createElement("span");
          sep.className = "tcode-fp-crumb-sep";
          sep.textContent = "/";
          sep.setAttribute("aria-hidden", "true");
          crumbs.append(sep);
        }
        nav(item.name, item.path, crumbs, "crumb");
      }
      crumbs.scrollLeft = crumbs.scrollWidth;
    }
    async function load(path?: string): Promise<void> {
      const currentRequest = ++sequence;
      error.textContent = "";
      choose.disabled = true;
      list.textContent = "正在讀取資料夾…";
      try {
        const url = "/api/project-folders" + (path ? "?path=" + encodeURIComponent(path) : "");
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("無法開啟資料夾。請檢查路徑與權限。");
        const item = await response.json() as Listing;
        if (!item || typeof item.current !== "string" || !Array.isArray(item.folders)) {
          throw new Error("資料夾清單資料不正確。");
        }
        if (currentRequest !== sequence || closed) return;
        data = item;
        address.value = item.current;
        selected.textContent = item.current;
        selected.title = item.current;
        search.value = "";
        choose.disabled = false;
        renderNav();
        renderList();
      } catch (cause) {
        if (currentRequest !== sequence || closed) return;
        error.textContent = cause instanceof Error ? cause.message : "無法讀取資料夾。";
        if (data) { address.value = data.current; choose.disabled = false; renderList(); }
        else list.replaceChildren();
      }
    }

    search.addEventListener("input", renderList);
    pathButton.onclick = () => {
      pathForm.hidden = !pathForm.hidden;
      pathButton.setAttribute("aria-expanded", String(!pathForm.hidden));
      if (!pathForm.hidden) address.focus();
    };
    pathForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = address.value.trim();
      if (value) void load(value);
    });
    createButton.onclick = () => {
      if (!data || creating) return;
      createForm.hidden = !createForm.hidden;
      if (!createForm.hidden) createName.focus();
    };
    createForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!data || creating) return;
      const name = createName.value;
      if (!name || name.length > 120 || name !== name.trim() || name.endsWith(".") ||
        /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)) {
        error.textContent = "名稱無效，請避免空格、特殊字元與 Windows 保留名稱。";
        return;
      }
      creating = true;
      createConfirm.disabled = true;
      const parent = data.current;
      error.textContent = "";
      void fetch("/api/project-folders", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-TCode-Folder-Action": "create" },
        body: JSON.stringify({ parent, name }),
      }).then(async (response) => {
        const result = await response.json() as { path?: string; error?: string };
        if (!response.ok || !result.path) throw new Error(result.error || "建立資料夾失敗。");
        if (!closed) {
          createForm.hidden = true;
          createName.value = "";
          await load(result.path);
        }
      }).catch((cause) => {
        if (!closed) error.textContent = cause instanceof Error ? cause.message : "建立資料夾失敗。";
      }).finally(() => {
        creating = false;
        createConfirm.disabled = false;
      });
    });
    choose.onclick = () => {
      if (!data || choose.disabled) return;
      remember(data.current);
      close(data.current);
    };
    el<HTMLButtonElement>('[data-action="close"]').focus();
    let last = "";
    try { last = localStorage.getItem(LAST_KEY) || ""; } catch {}
    void load(last || undefined).then(() => {
      if (!data && last && !closed) void load();
    });
  });
}
