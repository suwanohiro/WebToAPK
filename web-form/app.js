const STORAGE_KEY = "webtoapk.credentials";
const HISTORY_KEY = "webtoapk.packageHistory";
let iconBase64 = "";
let deferredInstallPrompt = null;
let customIconSelected = false;
let faviconPreviewVersion = 0;
let faviconDebounceTimer;

const $ = (id) => document.getElementById(id);

function loadCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return;
    $("owner").value = saved.owner || "";
    $("repo").value = saved.repo || "";
    $("branch").value = saved.branch || "main";
    $("token").value = saved.token || "";
    $("saveCredentials").checked = true;
  } catch {}

  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    $("packageHistory").replaceChildren(...history.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      return option;
    }));
  } catch {}
}

function saveCredentials() {
  if ($("saveCredentials").checked) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      owner: $("owner").value.trim(),
      repo: $("repo").value.trim(),
      branch: $("branch").value.trim() || "main",
      token: $("token").value
    }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function validatePackage() {
  const value = $("packageName").value.trim();
  const valid = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(value);
  $("packageError").textContent = valid ? "" : "小文字英数字とドット区切りで、最低2階層以上にしてください";
  return valid;
}

function normalizeUrl() {
  let value = $("targetUrl").value.trim();
  if (value && !/^https?:\/\//i.test(value)) value = "https://" + value;
  $("targetUrl").value = value;
  const valid = /^https?:\/\/[^\s]+$/i.test(value);
  $("urlError").textContent = valid ? "" : "http:// または https:// から始まるURLを入力してください";
  return valid;
}

function suggestPackageName() {
  const owner = $("owner").value.trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const appName = $("appName").value.trim();
  if (!appName) return;
  const slug = appName
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug && !$("packageName").dataset.edited) {
    $("packageName").value = `com.${owner || "example"}.${slug}`;
  }
}

async function findFaviconUrls(pageUrl) {
  const parsedPageUrl = new URL(pageUrl);
  const fallbackUrls = [
    new URL("/favicon.ico", parsedPageUrl.origin).href,
    new URL("/favicon.png", parsedPageUrl.origin).href,
    new URL("/apple-touch-icon.png", parsedPageUrl.origin).href
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(pageUrl, {
      credentials: "omit",
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !/html/i.test(contentType) || contentLength > 512000 || !response.body) {
      return fallbackUrls;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 512000) {
        await reader.cancel();
        return fallbackUrls;
      }
      chunks.push(value);
    }

    const html = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      html.set(chunk, offset);
      offset += chunk.length;
    }
    const parsedHtml = new DOMParser().parseFromString(new TextDecoder().decode(html), "text/html");
    const iconLinks = Array.from(parsedHtml.querySelectorAll("link[rel][href]"))
      .filter((link) => {
        const rel = link.rel.toLowerCase().split(/\s+/);
        return rel.some((value) => ["icon", "mask-icon", "apple-touch-icon"].includes(value));
      })
      .sort((left, right) => {
        const score = (link) => {
          const match = (link.sizes?.value || "").match(/(\d+)x(\d+)/i);
          return match ? Number(match[1]) * Number(match[2]) : 0;
        };
        return score(right) - score(left);
      })
      .map((link) => new URL(link.getAttribute("href"), response.url || pageUrl).href)
      .filter((url) => ["http:", "https:"].includes(new URL(url).protocol));

    return [...new Set([...iconLinks, ...fallbackUrls])];
  } catch (error) {
    console.info("Could not inspect page icon metadata; trying standard favicon paths.");
    return fallbackUrls;
  } finally {
    clearTimeout(timeout);
  }
}

function canLoadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

async function previewFavicon() {
  if (customIconSelected) return;
  const requestVersion = ++faviconPreviewVersion;
  let pageUrl = $("targetUrl").value.trim();
  if (!pageUrl) {
    $("iconPreview").hidden = true;
    $("iconSize").textContent = "URLを入力するとファビコンをプレビューします";
    return;
  }
  if (!/^https?:\/\//i.test(pageUrl)) pageUrl = `https://${pageUrl}`;

  let candidates;
  try {
    new URL(pageUrl);
    candidates = await findFaviconUrls(pageUrl);
  } catch {
    $("iconPreview").hidden = true;
    $("iconSize").textContent = "有効なURLを入力するとファビコンをプレビューします";
    return;
  }
  if (requestVersion !== faviconPreviewVersion || customIconSelected) return;

  for (const url of candidates) {
    if (!await canLoadImage(url)) continue;
    if (requestVersion !== faviconPreviewVersion || customIconSelected) return;
    $("iconPreview").src = url;
    $("iconPreview").alt = "URL先のファビコン";
    $("iconPreview").hidden = false;
    $("iconSize").textContent = "URL先のファビコン（APKビルド時に自動取得）";
    $("iconSize").style.color = "";
    return;
  }

  $("iconPreview").hidden = true;
  $("iconSize").textContent = "ファビコンをプレビューできませんでした。ビルド時に取得を試みます";
}

async function processIcon(file) {
  if (!file || !file.type.startsWith("image/")) {
    iconBase64 = "";
    customIconSelected = false;
    await previewFavicon();
    return;
  }

  customIconSelected = true;
  iconBase64 = "";
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("画像を処理できませんでした");
  }

  let dataUrl = "";
  let selectedFormat = "";
  let size = 256;
  for (const candidateSize of [256, 192, 128, 96, 64]) {
    size = candidateSize;
    canvas.width = size;
    canvas.height = size;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);

    for (const quality of [0.86, 0.72, 0.58]) {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("画像を圧縮できませんでした")), "image/webp", quality);
      });
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      iconBase64 = dataUrl.split(",", 2)[1];
      selectedFormat = blob.type === "image/webp" ? "WebP" : "PNG";
      if (iconBase64.length <= 45000 || blob.type !== "image/webp") break;
    }

    if (iconBase64.length <= 45000) break;
  }

  $("iconPreview").src = dataUrl;
  $("iconPreview").alt = "選択したアプリアイコン";
  $("iconPreview").hidden = false;
  const kb = Math.round(iconBase64.length * 0.75 / 1024);
  const withinLimit = iconBase64.length <= 45000;
  $("iconSize").textContent = `${size}×${size}px / ${selectedFormat} / ${kb} KB / Base64 ${iconBase64.length}文字${withinLimit ? "" : "（上限超過）"}`;
  $("iconSize").style.color = withinLimit ? "" : "#b42318";
  bitmap.close();
  if (!withinLimit) throw new Error("この画像は送信上限に収まりませんでした");
}

function setStatus(message, type = "") {
  $("status").textContent = message;
  $("status").className = `status ${type}`;
}

async function dispatchBuild() {
  saveCredentials();
  const owner = $("owner").value.trim();
  const repo = $("repo").value.trim();
  const branch = $("branch").value.trim() || "main";
  const token = $("token").value.trim();
  if (!$("appName").value.trim()) {
    setStatus("アプリ名は必須です", "error");
    return;
  }

  if (!owner || !repo || !token) {
    setStatus("Owner、Repo、Personal Access Token は必須です", "error");
    return;
  }
  if (!validatePackage() || !normalizeUrl()) return;
  if (iconBase64.length > 45000) {
    setStatus("アイコンのBase64文字数が上限を超えています", "error");
    return;
  }

  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  const packageName = $("packageName").value.trim();
  localStorage.setItem(HISTORY_KEY, JSON.stringify([
    packageName,
    ...history.filter((value) => value !== packageName)
  ].slice(0, 20)));

  const button = $("submitButton");
  button.disabled = true;
  setStatus("GitHub Actions にビルドを依頼しています...");

  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/build.yml/dispatches`,
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ref: branch,
          inputs: {
            app_name: $("appName").value.trim(),
            package_name: packageName,
            target_url: $("targetUrl").value.trim(),
            fullscreen: $("fullscreen").checked,
            icon_base64: iconBase64
          }
        })
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub API エラー (${response.status}): ${detail}`);
    }

    const actionsUrl = `https://github.com/${owner}/${repo}/actions`;
    $("status").innerHTML = "";
    $("status").className = "status success";
    const link = document.createElement("a");
    link.href = actionsUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "ビルドを開始しました。Actions 実行一覧を開く";
    $("status").append(link);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

loadCredentials();
$("appName").addEventListener("input", suggestPackageName);
$("owner").addEventListener("input", suggestPackageName);
$("packageName").addEventListener("input", () => {
  $("packageName").dataset.edited = "true";
  validatePackage();
});
$("targetUrl").addEventListener("input", () => {
  clearTimeout(faviconDebounceTimer);
  faviconDebounceTimer = setTimeout(previewFavicon, 400);
});
$("targetUrl").addEventListener("blur", () => {
  normalizeUrl();
  previewFavicon();
});
$("iconFile").addEventListener("change", (event) => processIcon(event.target.files[0]).catch((error) => {
  customIconSelected = false;
  iconBase64 = "";
  setStatus(error.message, "error");
  previewFavicon();
}));
$("dropZone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("dropZone").classList.add("dragover");
});
$("dropZone").addEventListener("dragleave", () => $("dropZone").classList.remove("dragover"));
$("dropZone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("dropZone").classList.remove("dragover");
  processIcon(event.dataTransfer.files[0]).catch((error) => {
    customIconSelected = false;
    iconBase64 = "";
    setStatus(error.message, "error");
    previewFavicon();
  });
});
$("submitButton").addEventListener("click", dispatchBuild);
$("installButton").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  await deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("installButton").hidden = true;
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("installButton").hidden = false;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $("installButton").hidden = true;
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./service-worker.js").catch((error) => {
    console.error("Service worker registration failed", error);
  });
}

validatePackage();
previewFavicon();
