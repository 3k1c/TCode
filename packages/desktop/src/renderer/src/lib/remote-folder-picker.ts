/**
 * Web-only directory picker. Filesystem access stays on the TCode host.
 * The phone never receives or opens local file handles.
 */
type Listing = {
  current: string;
  parent: string | null;
  roots: string[];
  breadcrumbs: Array<{ name: string; path: string }>;
  folders: Array<{ name: string; path: string }>;
  truncated: boolean;
};

const STYLE = `
.tcode-folder-mask{position:fixed;inset:0;z-index:2147483000;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;background:rgba(0,0,0,.58);padding:16px;font:14px/1.45 system-ui,sans-serif}
.tcode-folder-modal{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:100%;max-width:570px;min-width:0;overflow:hidden;max-height:min(92dvh,760px);padding:20px;color:#25292d;background:#fff;border:1px solid #e3e6e8;border-radius:18px;box-shadow:0 20px 60px #0005}
.tcode-folder-modal *{box-sizing:border-box}.tcode-folder-header{display:flex;align-items:center;justify-content:space-between;gap:10px}
.tcode-folder-header h2{font-size:18px;font-weight:650;margin:0}.tcode-folder-sub{font-size:12px;color:#687078;margin:0}
.tcode-folder-modal button,.tcode-folder-modal input{font:inherit}.tcode-folder-modal button{cursor:pointer}
.tcode-folder-icon{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:inherit;font-size:21px}
.tcode-folder-breadcrumb{display:flex;gap:5px;overflow:auto;white-space:nowrap;align-items:center;min-height:32px;min-width:0;max-width:100%}
.tcode-folder-breadcrumb button,.tcode-folder-roots button{border:0;background:#f0f2f3;border-radius:7px;padding:6px 9px;color:inherit;white-space:nowrap}
.tcode-folder-roots{display:flex;flex-wrap:wrap;gap:6px;max-height:64px;overflow:auto}
.tcode-folder-address{display:flex;gap:8px}.tcode-folder-modal input{width:100%;min-width:0;border:1px solid #cbd0d4;border-radius:8px;padding:10px;background:transparent;color:inherit}
.tcode-folder-address button{padding:0 14px;border-radius:8px;border:1px solid #cbd0d4;background:transparent;color:inherit}
.tcode-folder-body{flex:1;overflow:auto;min-height:135px;max-height:46dvh;border:1px solid #e6e8e9;border-radius:10px}
.tcode-folder-row{display:flex;width:100%;align-items:center;text-align:left;gap:10px;border:0;border-bottom:1px solid #eef0f1;padding:12px 13px;color:inherit;background:transparent;min-height:46px}
.tcode-folder-row:hover,.tcode-folder-row:focus-visible{background:#edf1f3}.tcode-folder-row span:last-child{margin-left:auto;color:#92999f}
.tcode-folder-empty{padding:16px;color:#778087}.tcode-folder-error{color:#b12a2a;min-height:16px;font-size:12px}
.tcode-folder-newbar{display:flex;justify-content:flex-start;gap:8px;align-items:center}
.tcode-folder-newbar button{color:inherit;background:#f0f2f3;border:1px solid #d0d5d9;border-radius:8px;min-height:36px;padding:7px 12px}
.tcode-folder-create{display:flex;gap:7px;align-items:center;flex-wrap:wrap;background:#f5f7f6;border:1px solid #e0e5e1;border-radius:10px;padding:9px}
.tcode-folder-create[hidden]{display:none}
.tcode-folder-create input{flex:1 1 140px;width:auto}
.tcode-folder-create button{padding:9px 12px;border:1px solid #cbd0d4;border-radius:8px;background:transparent;color:inherit}
.tcode-folder-create button[type=submit]{background:#254939;border-color:#254939;color:white}
.tcode-folder-footer{display:flex;justify-content:space-between;align-items:center;gap:8px}.tcode-folder-footer small{font-size:11px;color:#747b82}
.tcode-folder-actions{display:flex;gap:8px}.tcode-folder-actions button{border-radius:9px;padding:9px 12px;border:1px solid #d0d5d9;background:transparent;color:inherit}
.tcode-folder-actions .tcode-folder-choose{background:#254939;border-color:#254939;color:#fff;font-weight:650}
.tcode-folder-actions button:disabled,.tcode-folder-create button:disabled{opacity:.5;cursor:wait}
@media(prefers-color-scheme:dark){.tcode-folder-newbar button{color:inherit;background:#363a3e;border-color:#545b61}.tcode-folder-create{background:#303638;border-color:#545b61}.tcode-folder-create button{border-color:#545b61}}
@media(prefers-color-scheme:dark){.tcode-folder-modal{background:#242629;color:#f3f4f5;border-color:#44494c}.tcode-folder-breadcrumb button,.tcode-folder-roots button{background:#363a3e}.tcode-folder-modal input,.tcode-folder-address button{border-color:#545b61}.tcode-folder-body{border-color:#44494c}.tcode-folder-row{border-color:#41464b}.tcode-folder-row:hover,.tcode-folder-row:focus-visible{background:#383e40}.tcode-folder-empty,.tcode-folder-footer small,.tcode-folder-sub{color:#b8c1c5}.tcode-folder-actions button{border-color:#545b61}}
@media(max-width:480px){.tcode-folder-mask{padding:8px}.tcode-folder-modal{padding:14px;max-height:94dvh;gap:10px}.tcode-folder-body{max-height:43dvh}.tcode-folder-actions button{padding:9px 11px}}
`;

export function openRemoteFolderPicker(): Promise<string | null> {
  return new Promise((finish) => {
    const focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.append(style);
    const mask = document.createElement("div");
    mask.className = "tcode-folder-mask";
    mask.innerHTML = `
      <section class="tcode-folder-modal" role="dialog" aria-modal="true" aria-labelledby="tcode-folder-title">
        <header class="tcode-folder-header"><h2 id="tcode-folder-title">選擇專案資料夾</h2><button class="tcode-folder-icon" data-action="close" aria-label="關閉">×</button></header>
        <p class="tcode-folder-sub">瀏覽執行 TCode 的 Windows 電腦</p>
        <nav class="tcode-folder-roots" aria-label="磁碟機"></nav>
        <nav class="tcode-folder-breadcrumb" aria-label="目前路徑"></nav>
        <div class="tcode-folder-address"><input data-id="address" aria-label="完整路徑" placeholder="C:\\Users\\user\\Projects" spellcheck="false"><button data-action="go">前往</button></div>
        <input data-id="search" type="search" placeholder="搜尋這一層的資料夾" aria-label="搜尋資料夾">
        <div class="tcode-folder-newbar"><button type="button" data-action="new">＋ 新增資料夾</button></div>
        <form class="tcode-folder-create" data-id="create-form" hidden>
          <input data-id="new-name" aria-label="新資料夾名稱" placeholder="新資料夾名稱" maxlength="120" autocomplete="off" required>
          <button type="button" data-action="new-cancel">取消</button>
          <button type="submit" data-action="new-confirm">建立</button>
        </form>
        <div class="tcode-folder-body" role="list"></div>
        <div class="tcode-folder-error" role="alert"></div>
        <footer class="tcode-folder-footer"><small>選取的路徑屬於 Windows 電腦</small><div class="tcode-folder-actions"><button data-action="cancel">取消</button><button class="tcode-folder-choose" data-action="choose">選擇此資料夾</button></div></footer>
      </section>`;
    document.body.append(mask);
    const el = <T extends HTMLElement>(selector: string): T => {
      const node = mask.querySelector<T>(selector);
      if (!node) throw new Error("Folder picker layout incomplete.");
      return node;
    };
    const address = el<HTMLInputElement>('[data-id="address"]');
    const search = el<HTMLInputElement>('[data-id="search"]');
    const folderList = el<HTMLDivElement>(".tcode-folder-body");
    const breadcrumbs = el<HTMLElement>(".tcode-folder-breadcrumb");
    const roots = el<HTMLElement>(".tcode-folder-roots");
    const error = el<HTMLDivElement>(".tcode-folder-error");
    const choose = el<HTMLButtonElement>('[data-action="choose"]');
    const createForm = el<HTMLFormElement>('[data-id="create-form"]');
    const createName = el<HTMLInputElement>('[data-id="new-name"]');
    const createConfirm = el<HTMLButtonElement>('[data-action="new-confirm"]');
    const newButton = el<HTMLButtonElement>('[data-action="new"]');
    let creating = false;
    const hideCreate = () => {
      createForm.hidden = true;
      createName.value = "";
      newButton.focus();
    };
    newButton.onclick = () => {
      if (!data) return;
      createForm.hidden = false;
      createName.focus();
    };
    el<HTMLButtonElement>('[data-action="new-cancel"]').onclick = hideCreate;
    let data: Listing | null = null;
    let request = 0;
    let closed = false;
    const close = (value: string | null) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKeyDown, true);
      mask.remove();
      style.remove();
      focusBefore?.focus();
      finish(value);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(null); }
      if (event.key === "Tab") {
        const focusable = [...mask.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    mask.addEventListener("click", (e) => { if (e.target === mask) close(null); });
    el<HTMLButtonElement>('[data-action="close"]').onclick = () => close(null);
    el<HTMLButtonElement>('[data-action="cancel"]').onclick = () => close(null);
    const navButton = (name: string, dest: string, container: HTMLElement, className = "") => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.className = className;
      button.onclick = () => { void load(dest); };
      container.append(button);
    };
    const renderList = () => {
      folderList.replaceChildren();
      if (!data) return;
      const term = search.value.trim().toLocaleLowerCase();
      const rows = data.folders.filter((f) => f.name.toLocaleLowerCase().includes(term));
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "tcode-folder-empty";
        empty.textContent = term ? "沒有符合的資料夾" : "此資料夾沒有子資料夾";
        folderList.append(empty);
      }
      for (const folder of rows) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tcode-folder-row";
        const glyph = document.createElement("span");
        glyph.textContent = "📁";
        const label = document.createElement("span");
        label.textContent = folder.name;
        label.style.overflowWrap = "anywhere";
        const arrow = document.createElement("span");
        arrow.textContent = "›";
        button.append(glyph, label, arrow);
        button.onclick = () => { void load(folder.path); };
        folderList.append(button);
      }
      if (data.truncated && !term) {
        const message = document.createElement("div");
        message.className = "tcode-folder-empty";
        message.textContent = "資料夾較多，請使用上方路徑直接前往。";
        folderList.append(message);
      }
    };
    async function load(path?: string): Promise<void> {
      const sequence = ++request;
      error.textContent = "";
      choose.disabled = true;
      folderList.textContent = "正在讀取資料夾…";
      try {
        const uri = "/api/project-folders" + (path ? "?path=" + encodeURIComponent(path) : "");
        const response = await fetch(uri, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("無法開啟資料夾。請確認路徑存在及權限。");
        const result = await response.json() as Listing;
        if (!result || typeof result.current !== "string" || !Array.isArray(result.folders)) throw new Error("資料夾資料格式不正確。");
        if (sequence !== request || closed) return;
        data = result;
        address.value = result.current;
        search.value = "";
        roots.replaceChildren();
        for (const drive of result.roots) navButton(drive, drive, roots);
        breadcrumbs.replaceChildren();
        if (result.parent) navButton("↑", result.parent, breadcrumbs);
        for (const part of result.breadcrumbs) navButton(part.name, part.path, breadcrumbs);
        choose.disabled = false;
        renderList();
      } catch (reason) {
        if (sequence !== request || closed) return;
        error.textContent = reason instanceof Error ? reason.message : "無法讀取資料夾";
        if (data) { address.value = data.current; choose.disabled = false; renderList(); }
        else folderList.textContent = "";
      }
    }
    createForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!data || creating) return;
      const name = createName.value;
      if (!name || name.trim() !== name || /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
          name.endsWith(".") || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)) {
        error.textContent = "資料夾名稱無效。不能包含特殊字元或以空格、句點結尾。";
        return;
      }
      const parent = data.current;
      creating = true;
      createConfirm.disabled = true;
      error.textContent = "";
      void fetch("/api/project-folders", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-TCode-Folder-Action": "create" },
        body: JSON.stringify({ parent, name }),
      }).then(async response => {
        const result = await response.json() as { path?: string; error?: string };
        if (!response.ok || !result.path) throw new Error(result.error ?? "新增資料夾失敗。");
        if (!closed) {
          hideCreate();
          await load(result.path);
        }
      }).catch(cause => {
        if (!closed) error.textContent = cause instanceof Error ? cause.message : "新增資料夾失敗。";
      }).finally(() => {
        creating = false;
        createConfirm.disabled = false;
      });
    });
    search.addEventListener("input", renderList);
    el<HTMLButtonElement>('[data-action="go"]').onclick = () => { void load(address.value.trim()); };
    address.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void load(address.value.trim()); } });
    choose.onclick = () => {
      if (!data) return;
      try { localStorage.setItem("tcode.lastProjectDir", data.current); } catch {}
      close(data.current);
    };
    el<HTMLButtonElement>('[data-action="close"]').focus();
    let last = "";
    try { last = localStorage.getItem("tcode.lastProjectDir") ?? ""; } catch {}
    void load(last || undefined).then(() => {
      if (!data && last) void load();
    });
  });
}
