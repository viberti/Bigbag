// Pré-processamento da imagem da fatura ANTES do VLM: facilita a leitura e
// corta custo/tempo (a foto crua do telemóvel tem 3–5 MB; não é preciso).
//  - orientação EXIF, redimensiona (largura máx.), tons de cinza,
//  - normaliza contraste (térmicas desbotadas), leve nitidez.
// O ORIGINAL é guardado em disco à parte (auditoria/re-extração); isto é só
// para a chamada ao modelo. Em caso de erro, devolve o original.
import sharp from 'sharp';

export async function preProcessarImagem(buffer, { largura = 1400 } = {}) {
  try {
    const out = await sharp(buffer)
      .rotate() // aplica a orientação EXIF (foto de telemóvel)
      .resize({ width: largura, withoutEnlargement: true })
      .grayscale()
      .normalize() // estica o contraste
      .sharpen()
      .jpeg({ quality: 82 })
      .toBuffer();
    return { buffer: out, mime: 'image/jpeg' };
  } catch {
    return { buffer, mime: 'image/jpeg' };
  }
}
