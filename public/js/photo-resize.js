/*
 * Downscale and re-encode a photo before upload.
 *
 * Its own file because three pages now need it -- estimates, work orders, and
 * the crew's job sheet -- and the crew page must not load the admin bundle:
 * that carries adminFetch, which bounces a 401 to the login screen. A crew
 * member sent to an admin login by their own link would simply give up.
 *
 * A modern phone camera produces 4-8MB files that blow past the 4MB request
 * limit. 1600px on the long edge is plenty for a proposal or a job record and
 * lands well under the cap.
 *
 * Always re-encodes to JPEG: HEIC and PNG screenshots both arrive here, and the
 * upload endpoints only accept JPEG, PNG or WebP.
 */
const MAX_PHOTO_DIMENSION = 1600;

function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
        const scale = MAX_PHOTO_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}
