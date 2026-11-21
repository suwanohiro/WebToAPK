const STORAGE_KEY = "webtoapk.credentials";
const HISTORY_KEY = "webtoapk.packageHistory";
let iconBase64 = "";
let deferredInstallPrompt = null;

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

async function processIcon(file) {
  if (!file || !file.type.startsWith("image/")) {
    iconBase64 = "";
    $("iconPreview").hidden = true;
    $("iconSize").textContent = "既定アイコンを使用します";
    return;
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  let dataUrl = "";
  let size = 256;
  for (const candidateSize of [256, 192, 128]) {
    size = candidateSize;
    canvas.width = size;
    canvas.height = size;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG画像を生成できませんでした")), "image/png");
    });
    dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    iconBase64 = dataUrl.split(",", 2)[1];
    if (iconBase64.length <= 45000) break;
  }

  $("iconPreview").src = dataUrl;
  $("iconPreview").hidden = false;
  const kb = Math.round(iconBase64.length * 0.75 / 1024);
  const withinLimit = iconBase64.length <= 45000;
  $("iconSize").textContent = `${size}×${size}px / ${kb} KB / Base64 ${iconBase64.length}文字${withinLimit ? "" : "（上限超過）"}`;
  $("iconSize").style.color = withinLimit ? "" : "#b42318";
  bitmap.close();
  if (!withinLimit) throw new Error("アイコンをより小さい画像にしてから選択してください");
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
$("targetUrl").addEventListener("blur", normalizeUrl);
$("iconFile").addEventListener("change", (event) => processIcon(event.target.files[0]).catch((error) => setStatus(error.message, "error")));
$("dropZone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("dropZone").classList.add("dragover");
});
$("dropZone").addEventListener("dragleave", () => $("dropZone").classList.remove("dragover"));
$("dropZone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("dropZone").classList.remove("dragover");
  processIcon(event.dataTransfer.files[0]).catch((error) => setStatus(error.message, "error"));
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
