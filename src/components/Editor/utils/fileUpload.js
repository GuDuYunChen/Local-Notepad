
// Compression is optional: every browser callback must settle, including
// canvas/decoder failures. Callers can then safely retain the original image.
export const IMAGE_COMPRESSION_TIMEOUT_MS = 15000;
export const compressImage = (file, { signal } = {}) => new Promise((resolve, reject) => {
    let reader, image, canvas, timer, settled = false;
    const abortError = () => new DOMException('图片处理已取消', 'AbortError');
    const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (reader) {
            reader.onload = reader.onerror = reader.onabort = null;
            if (reader.readyState === 1) { try { reader.abort(); } catch {} }
        }
        if (image) { image.onload = image.onerror = null; try { image.src = ''; } catch {} }
        if (canvas) { try { canvas.width = 0; canvas.height = 0; } catch {} }
        if (error) reject(error); else resolve(result);
    };
    const onAbort = () => finish(abortError());
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(new Error('图片处理超时，改用原图')), IMAGE_COMPRESSION_TIMEOUT_MS);
    try {
        reader = new FileReader();
        image = new Image();
        reader.onerror = () => finish(new Error('无法读取图片'));
        reader.onabort = onAbort;
        image.onerror = () => finish(new Error('无法解码图片'));
        image.onload = () => {
            if (settled) return;
            try {
                const width = image.naturalWidth || image.width;
                const height = image.naturalHeight || image.height;
                if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('图片尺寸无效');
                const ratio = Math.min(1, 1920 / width, 1080 / height);
                canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.floor(width * ratio));
                canvas.height = Math.max(1, Math.floor(height * ratio));
                const context = canvas.getContext('2d');
                if (!context) throw new Error('图片处理不可用');
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    if (settled) return;
                    try {
                        if (!blob || blob.size === 0 || blob.type !== 'image/jpeg') throw new Error('无法生成压缩图片');
                        const name = (file.name || 'image').replace(/\.[^./\\]+$/, '') + '.jpg';
                        finish(null, new File([blob], name, { type: 'image/jpeg' }));
                    } catch (error) { finish(error); }
                }, 'image/jpeg', 0.7);
            } catch (error) { finish(error); }
        };
        reader.onload = event => {
            if (settled) return;
            try {
                if (typeof event.target?.result !== 'string') throw new Error('无法读取图片');
                image.src = event.target.result;
            } catch (error) { finish(error); }
        };
        // Register callbacks before either operation: cached/synchronous mock
        // completions must follow the same path as asynchronous browser events.
        reader.readAsDataURL(file);
    } catch (error) { finish(error); }
});

export const generateVideoMetadata = (file) => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = URL.createObjectURL(file);
        video.onloadedmetadata = () => {
            video.currentTime = Math.min(1, video.duration > 0 ? video.duration / 2 : 0);
        };
        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (blob) {
                    const coverFile = new File([blob], 'cover.jpg', { type: 'image/jpeg' });
                    resolve({ duration: video.duration, coverFile });
                } else {
                    resolve({ duration: video.duration, coverFile: null });
                }
            }, 'image/jpeg', 0.7);
        };
        video.onerror = () => {
             // If video fails to load (format not supported by browser), just return nulls
             resolve({ duration: 0, coverFile: null });
        };
    });
};

let xlsxPromise = null;

export const loadXLSX = () => {
  if (!xlsxPromise) {
    xlsxPromise = import('xlsx')
      .then((module) => module.default || module)
      .catch((error) => {
        xlsxPromise = null;
        throw error;
      });
  }
  return xlsxPromise;
};

export const uploadFile = async (file, { signal } = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const baseUrl = window.__API_BASE__ || 'http://127.0.0.1:27121';
        const res = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            body: formData,
            ...(signal ? { signal } : {}),
        });
        if (!res.ok) throw new Error('上传失败，请重试');
        const json = await res.json();
        if (json.code !== 0) throw new Error(json.message || '上传失败');
        if (typeof json.data?.url !== 'string' || !/^\/uploads\/[^/\\?#]+$/.test(json.data.url)) throw new Error('上传结果无效，请重试');
        return { url: `${baseUrl}${json.data.url}`, name: json.data.filename };
    } catch (e) {
        console.error('Upload failed', e);
        // Throw error so caller knows it failed
        throw e;
    }
};
