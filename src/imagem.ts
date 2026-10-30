import { FOTO_MAX, MINI_MAX, medidas } from './regras';

/** Abre a foto (câmera ou galeria, inclusive HEIC no iPhone) já girada pelo EXIF. */
async function abrir(arquivo: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('Não deu para abrir essa foto. Tente tirar outra.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function jpeg(img: HTMLImageElement, max: number, qualidade: number): Promise<Blob> {
  const { w, h } = medidas(img.naturalWidth, img.naturalHeight, max);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((ok, falha) =>
    c.toBlob((b) => (b ? ok(b) : falha(new Error('Não deu para preparar a foto.'))), 'image/jpeg', qualidade),
  );
}

/** Foto para o mural (1600 px) e miniatura (480 px), em JPEG. */
export async function preparar(arquivo: Blob): Promise<{ foto: Blob; mini: Blob }> {
  const img = await abrir(arquivo);
  const foto = await jpeg(img, FOTO_MAX, 0.82);
  const mini = await jpeg(img, MINI_MAX, 0.78);
  return { foto, mini };
}
