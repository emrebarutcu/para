// ---------- Cihazdaki dil modeli (Web Worker) ----------
// Küçük, çok dilli bir metin gömme modeli metinleri anlam vektörüne çevirir (kategori.js benzerliğe göre sıralar).
// Model ve kütüphane (transformers.js, ONNX Runtime) ilk açılışta indirilir, tarayıcının önbelleğinde kalır; sonra
// internet gerekmez. Veri cihazdan çıkmaz. Arayüz donmasın diye ayrı iş parçacığında; işlemcide (WASM, 8 bit) çalışır:
// bu boyuttaki bir model için ekran kartının açılış maliyeti kazandırdığından fazladır, her telefonda aynı davranır.
// Mesajlar (yz.js):
//   → { type: "load", model, dtype }            ← { type: "progress", loaded, total } … { type: "ready" }
//   → { type: "embed", id, texts }              ← { type: "vectors", id, vectors: [Float32Array] }
//   ← { type: "error", id?, message }
import * as tf from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js";

const BATCH = 32;   // bir geçişte vektöre çevrilen en fazla metin
let embed = null, loading = null;
let queue = Promise.resolve();   // istekler sırayla

// İndirme ilerlemesi: dosya başına bayt; toplam bilinen dosyaların toplamı
function progress() {
  const files = new Map();
  return e => {
    if (e.status !== "progress" && e.status !== "done") return;
    const f = files.get(e.file) || { loaded: 0, total: 0 };
    if (e.status === "progress") files.set(e.file, { loaded: e.loaded, total: e.total });
    else files.set(e.file, { loaded: f.total || f.loaded, total: f.total || f.loaded });
    let loaded = 0, total = 0;
    for (const x of files.values()) { loaded += x.loaded; total += x.total; }
    postMessage({ type: "progress", loaded, total });
  };
}

async function vectors(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const t = await embed(texts.slice(i, i + BATCH), { pooling: "mean", normalize: true });
    const [n, d] = t.dims;
    for (let k = 0; k < n; k++) out.push(t.data.slice(k * d, (k + 1) * d));
    t.dispose?.();
  }
  return out;
}

self.onmessage = ({ data }) => {
  if (data.type === "load") {
    loading ??= tf.pipeline("feature-extraction", data.model, { device: "wasm", dtype: data.dtype, progress_callback: progress() })
      .then(p => { embed = p; postMessage({ type: "ready" }); })
      .catch(err => { loading = null; postMessage({ type: "error", message: String(err?.message || err) }); });
    return;
  }
  if (data.type === "embed") {
    queue = queue.then(async () => {
      try {
        if (!embed) throw new Error("model yüklenmedi");
        const list = await vectors(data.texts);
        postMessage({ type: "vectors", id: data.id, vectors: list }, list.map(v => v.buffer));
      } catch (err) {
        postMessage({ type: "error", id: data.id, message: String(err?.message || err) });
      }
    });
  }
};
