export async function compressPhoto(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Fotoğraf açılamadı. Başka bir görsel seçin.'))
      image.src = url
    })
    const ratio = Math.min(1, 1200 / image.width, 1200 / image.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * ratio)
    canvas.height = Math.round(image.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Fotoğraf işlenemedi.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    let result: Blob | null = null
    for (let quality = 7; quality >= 1; quality--) {
      result = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality / 10),
      )
      if (!result) throw new Error('Fotoğraf sıkıştırılamadı.')
      if (result.size <= 700_000) break
    }
    return result!
  } finally {
    URL.revokeObjectURL(url)
  }
}
