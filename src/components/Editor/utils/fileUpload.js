
export const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 1920; 
                const MAX_HEIGHT = 1080;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) {
                        const newFile = new File([blob], file.name, { type: 'image/jpeg' });
                        resolve(newFile);
                    } else {
                        reject(new Error('Canvas to Blob failed'));
                    }
                }, 'image/jpeg', 0.7);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

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

export const loadXLSX = () => {
  return new Promise((resolve, reject) => {
    if (window.XLSX) {
      resolve(window.XLSX);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => {
      if (window.XLSX) resolve(window.XLSX); else reject(new Error('XLSX load failed'));
    };
    s.onerror = () => reject(new Error('XLSX load error'));
    document.head.appendChild(s);
  });
};

export const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const baseUrl = window.__API_BASE__ || 'http://127.0.0.1:27121';
        const res = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            body: formData,
        });
        const json = await res.json();
        if (json.code !== 0) throw new Error(json.message);
        return { url: `${baseUrl}${json.data.url}`, name: json.data.filename };
    } catch (e) {
        console.error('Upload failed', e);
        // Throw error so caller knows it failed
        throw e;
    }
};
