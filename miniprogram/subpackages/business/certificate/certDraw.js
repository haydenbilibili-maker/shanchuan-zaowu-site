/**
 * 证书绘制（纯函数，不依赖 wx —— check:gift-holder 在 Node 里录制指令 / 离线出图）
 *
 * drawHolderCert  非礼赠收藏证书：版式为原 drawPerfectCert（设计高 560，金样 scripts/fixtures/certHolderGolden.json 逐条相同）；
 *                 画布矮于 560（真机 600rpx×960rpx ≈ 300×480）时整体等比缩放，不再挤压重叠（2026-09-28 N5 点名顺手修）
 * drawGiftHolderCert  受礼人收藏证书：同一金色家族 + 「由 X 赠予」与赠言，日期为签收日
 * drawGiftVoucher  送礼人赠予凭证：象牙纸 + 朱砂，记录赠予对象 / 藏品 / 赠言 / 日期
 * 礼赠两版按画布高度等比排版（原版为固定像素，375 宽真机底部会挤，非礼赠不改）。
 */

async function loadImage(canvas, getImagePath, src) {
  const url = await getImagePath(src)
  if (!url) return null
  const img = canvas.createImage()
  img.src = url
  await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve })
  return img.width && img.height ? img : null
}

function textWidth(ctx, text, size) {
  const m = ctx.measureText(text)
  return (m && m.width) || String(text).length * size
}

/** 超宽时逐级缩小字号（不低于 minSize），返回实际字号 */
function fitFont(ctx, text, maxWidth, size, minSize, style) {
  let s = size
  ctx.font = `${style} ${s}px serif`
  while (s > minSize && textWidth(ctx, text, s) > maxWidth) {
    s -= 1
    ctx.font = `${style} ${s}px serif`
  }
  return s
}

function clip(text, max) {
  const t = String(text || '')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function drawSeal(ctx, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-15 * Math.PI / 180);
  const color = 'rgba(180, 40, 40, 0.9)';
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 30, 0, 2 * Math.PI); ctx.stroke();
  ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 2 * Math.PI); ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = 'bold 10px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('山海造物', 0, -8);
  ctx.font = '8px sans-serif'; ctx.fillText('CERTIFIED', 0, 8);
  ctx.font = '14px serif'; ctx.fillText('★', 0, 22);
  ctx.restore();
}

/** 普通收藏证书的设计高度：原固定像素版式在此高度下排得下 */
const HOLDER_DESIGN_H = 560

async function drawHolderCert(ctx, w, h, data, canvas, getImagePath) {
  const s = h / HOLDER_DESIGN_H
  if (s >= 1) return drawHolderLayout(ctx, w, h, data, canvas, getImagePath)
  ctx.save()
  ctx.scale(s, s)
  await drawHolderLayout(ctx, w / s, HOLDER_DESIGN_H, data, canvas, getImagePath)
  ctx.restore()
}

async function drawHolderLayout(ctx, w, h, data, canvas, getImagePath) {
  // 1. 背景
  ctx.fillStyle = '#1F1D1A';
  ctx.fillRect(0, 0, w, h);

  // 2. 边框 (Art Deco)
  const p = 20;
  ctx.strokeStyle = '#C4A76C'; ctx.lineWidth = 1;
  ctx.strokeRect(p, p, w - p*2, h - p*2);
  ctx.strokeStyle = 'rgba(196, 167, 108, 0.3)';
  ctx.strokeRect(p+4, p+4, w - (p+4)*2, h - (p+4)*2);

  // 3. 头部
  let y = 55;
  ctx.textAlign = 'center';

  ctx.fillStyle = '#666'; ctx.font = '9px sans-serif'; ctx.letterSpacing = '2px';
  ctx.fillText("BRING NATURE HOME", w / 2, y);

  y += 20;
  ctx.fillStyle = '#C4A76C'; ctx.font = 'bold 15px serif';
  ctx.fillText('山海造物 · 珍藏证书', w / 2, y);

  y += 35;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 20px serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('馆藏证书·仅此一件', w / 2, y);

  y += 25;
  ctx.fillStyle = '#bfa15f'; ctx.font = '10px sans-serif'; ctx.letterSpacing = '1px';
  ctx.fillText('CERTIFICATE OF HONOR', w / 2, y);

  // 4. 图片
  const imgUrl = await getImagePath(data.product.image);

  y += 25;
  const imgSize = 150;

  if (imgUrl) {
      const img = canvas.createImage();
      img.src = imgUrl;
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });

      if (img.width && img.height) {
        const imgX = (w - imgSize) / 2;
        ctx.strokeStyle = 'rgba(196, 167, 108, 0.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(imgX - 5, y - 5, imgSize + 10, imgSize + 10);

        const sSize = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - sSize)/2, (img.height - sSize)/2, sSize, sSize, imgX, y, imgSize, imgSize);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = 'italic 9px serif';
      ctx.fillText('Exhibited Specimen', w/2, y + imgSize + 14);

      y += imgSize + 40;
  } else {
      y += 200;
  }

  // 5. 授予文案区
  ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.letterSpacing = '2px';
  ctx.fillText('兹授予 / Hereby Grants', w / 2, y);

  y += 30;
  ctx.fillStyle = '#C4A76C'; ctx.font = 'bold 30px serif';
  ctx.fillText(data.user, w / 2, y);

  y += 20;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
  ctx.fillText(`「 ${data.level} 」`, w / 2, y);

  y += 30;
  ctx.fillStyle = '#aaa'; ctx.font = '10px serif'; ctx.letterSpacing = '1px';
  ctx.fillText('以表彰其对以下自然瑰宝的永久珍藏：', w / 2, y);

  y += 30;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 24px serif';
  ctx.fillText(`《 ${data.product.title} 》`, w / 2, y);

  y += 16;
  ctx.fillStyle = '#C4A76C'; ctx.font = 'italic 10px serif';
  ctx.fillText(data.product.latin || '', w / 2, y);

  // 6. 底部签名 & 编号
  const footerY = h - 40;

  ctx.fillStyle = '#444'; ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`NO.${data.orderNo}`, 30, footerY);
  ctx.textAlign = 'right';
  ctx.fillText(data.date, w - 30, footerY);

  const signY = footerY - 30;
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w/2 - 60, signY); ctx.lineTo(w/2 + 60, signY); ctx.stroke();
  ctx.fillStyle = '#666'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('山海造物 · 签发', w / 2, signY + 14);

  // 7. 印章
  drawSeal(ctx, w - 80, h - 100);
}

function drawSquareImage(ctx, img, x, y, size, frameColor) {
  ctx.strokeStyle = frameColor; ctx.lineWidth = 1;
  ctx.strokeRect(x - 4, y - 4, size + 8, size + 8);
  if (!img) return
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, x, y, size, size);
}

function drawFooter(ctx, w, h, k, serial, date, signLabel, color, lineColor) {
  const footerY = h - 26 * k;
  ctx.letterSpacing = '0px';
  ctx.fillStyle = color; ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`NO.${serial}`, 28, footerY);
  ctx.textAlign = 'right';
  ctx.fillText(date, w - 28, footerY);
  const signY = footerY - 24 * k;
  ctx.strokeStyle = lineColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w / 2 - 50, signY); ctx.lineTo(w / 2 + 50, signY); ctx.stroke();
  ctx.fillStyle = color; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(signLabel, w / 2, signY + 12);
}

/** 受礼人（持有人）收藏证书 */
async function drawGiftHolderCert(ctx, w, h, data, canvas, getImagePath) {
  const gift = data.gift || {}
  const k = h / 480
  const cx = w / 2
  ctx.fillStyle = '#1F1D1A'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#C4A76C'; ctx.lineWidth = 1;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.strokeStyle = 'rgba(196, 167, 108, 0.3)';
  ctx.strokeRect(22, 22, w - 44, h - 44);

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#666'; ctx.font = '8px sans-serif'; ctx.letterSpacing = '2px';
  ctx.fillText('BRING NATURE HOME', cx, 40 * k);
  ctx.fillStyle = '#C4A76C'; ctx.font = 'bold 14px serif';
  ctx.fillText('山海造物 · 珍藏证书', cx, 58 * k);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 18px serif'; ctx.letterSpacing = '3px';
  ctx.fillText('馆藏证书·仅此一件', cx, 82 * k);
  ctx.fillStyle = '#bfa15f'; ctx.font = '9px sans-serif'; ctx.letterSpacing = '1px';
  ctx.fillText('CERTIFICATE OF HONOR', cx, 98 * k);

  const size = Math.min(104 * k, w * 0.38)
  const top = 110 * k
  const img = await loadImage(canvas, getImagePath, data.product.image)
  drawSquareImage(ctx, img, cx - size / 2, top, size, 'rgba(196, 167, 108, 0.6)')

  let y = top + size + 24 * k
  ctx.fillStyle = '#888'; ctx.font = '9px sans-serif'; ctx.letterSpacing = '2px';
  ctx.fillText('兹授予 / Hereby Grants', cx, y)
  y += 26 * k
  ctx.letterSpacing = '0px'
  ctx.fillStyle = '#C4A76C'
  fitFont(ctx, data.user, w - 70, 24, 14, 'bold')
  ctx.fillText(data.user, cx, y)
  y += 18 * k
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
  ctx.fillText(`「 ${data.level} 」`, cx, y)
  y += 22 * k
  ctx.fillStyle = '#aaa'; ctx.font = '9px serif'; ctx.letterSpacing = '1px';
  ctx.fillText('以表彰其对以下自然瑰宝的永久珍藏：', cx, y)
  y += 24 * k
  ctx.letterSpacing = '0px'; ctx.fillStyle = '#fff'
  const title = `《 ${data.product.title} 》`
  fitFont(ctx, title, w - 60, 18, 11, 'bold')
  ctx.fillText(title, cx, y)
  y += 14 * k
  ctx.fillStyle = '#C4A76C'; ctx.font = 'italic 9px serif';
  ctx.fillText(data.product.latin || '', cx, y)

  // 礼赠带：由谁赠予 + 赠言（收藏证书与赠予凭证的区别在此）
  y += 20 * k
  ctx.strokeStyle = 'rgba(196, 167, 108, 0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - 70, y - 12 * k); ctx.lineTo(cx + 70, y - 12 * k); ctx.stroke();
  ctx.fillStyle = '#C4A76C'; ctx.font = '10px serif';
  ctx.fillText(`由「${clip(gift.fromName || '一位友人', 10)}」赠予 · ${data.date}`, cx, y)
  if (gift.note) {
    y += 15 * k
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'italic 9px serif';
    ctx.fillText(`“${clip(gift.note, 18)}”`, cx, y)
  }

  drawFooter(ctx, w, h, k, data.serial, data.date, '山海造物 · 签发', '#555', '#333')
  ctx.save(); ctx.translate(w - 50, h - 64 * k); ctx.scale(0.72, 0.72)
  drawSeal(ctx, 0, 0)
  ctx.restore()
}

function drawGiftSeal(ctx, x, y) {
  const color = 'rgba(158, 59, 46, 0.92)'
  ctx.save(); ctx.translate(x, y); ctx.rotate(-8 * Math.PI / 180);
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.strokeRect(-20, -20, 40, 40);
  ctx.lineWidth = 1; ctx.strokeRect(-16, -16, 32, 32);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 20px serif'; ctx.fillText('赠', 0, 1);
  ctx.restore();
}

/** 送礼人赠予凭证 */
async function drawGiftVoucher(ctx, w, h, data, canvas, getImagePath) {
  const gift = data.gift || {}
  const k = h / 480
  const cx = w / 2
  const ink = '#2C2C2C'
  const cinnabar = '#9E3B2E'
  const brass = '#8B6F47'
  ctx.fillStyle = '#F3ECDD'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = cinnabar; ctx.lineWidth = 1.5;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.strokeStyle = 'rgba(158, 59, 46, 0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(21, 21, w - 42, h - 42);

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = brass; ctx.font = '8px sans-serif'; ctx.letterSpacing = '2px';
  ctx.fillText('A GIFT FROM NATURE', cx, 40 * k)
  ctx.fillStyle = cinnabar; ctx.font = 'bold 16px serif'; ctx.letterSpacing = '3px';
  ctx.fillText('山海造物 · 赠予凭证', cx, 62 * k)
  ctx.fillStyle = brass; ctx.font = '9px sans-serif'; ctx.letterSpacing = '1px';
  ctx.fillText('CERTIFICATE OF GIFT', cx, 78 * k)

  const size = Math.min(92 * k, w * 0.34)
  const top = 92 * k
  const img = await loadImage(canvas, getImagePath, data.product.image)
  drawSquareImage(ctx, img, cx - size / 2, top, size, 'rgba(158, 59, 46, 0.5)')

  let y = top + size + 26 * k
  ctx.fillStyle = '#7A7268'; ctx.font = '10px serif'; ctx.letterSpacing = '2px';
  ctx.fillText('兹证明', cx, y)
  y += 26 * k
  ctx.letterSpacing = '0px'; ctx.fillStyle = ink
  fitFont(ctx, data.user, w - 70, 22, 14, 'bold')
  ctx.fillText(data.user, cx, y)
  y += 22 * k
  ctx.fillStyle = '#7A7268'; ctx.font = '10px serif'; ctx.letterSpacing = '1px';
  ctx.fillText('将以下藏品郑重赠予', cx, y)
  y += 26 * k
  ctx.letterSpacing = '0px'; ctx.fillStyle = cinnabar
  const to = `「 ${clip(gift.recipientName || 'TA', 12)} 」`
  fitFont(ctx, to, w - 70, 18, 12, 'bold')
  ctx.fillText(to, cx, y)
  y += 26 * k
  ctx.fillStyle = ink
  const title = `《 ${data.product.title} 》`
  fitFont(ctx, title, w - 60, 16, 11, 'bold')
  ctx.fillText(title, cx, y)
  y += 14 * k
  ctx.fillStyle = brass; ctx.font = 'italic 9px serif';
  ctx.fillText(data.product.latin || '', cx, y)

  if (gift.note) {
    y += 22 * k
    ctx.fillStyle = '#5E564C'; ctx.font = 'italic 10px serif';
    const note = String(gift.note)
    ctx.fillText(`“${note.slice(0, 16)}${note.length > 16 ? '' : '”'}`, cx, y)
    if (note.length > 16) {
      y += 15 * k
      ctx.fillText(`${clip(note.slice(16), 15)}”`, cx, y)
    }
  }
  y += 22 * k
  ctx.fillStyle = brass; ctx.font = '10px sans-serif';
  ctx.fillText(`${gift.statusLabel || 'TA 已收到'} · ${data.date}`, cx, y)

  drawFooter(ctx, w, h, k, data.serial, data.date, '山海造物 · 见证', '#8A8176', 'rgba(44,44,44,0.3)')
  drawGiftSeal(ctx, w - 56, h - 78 * k)
}

async function drawCertificate(ctx, w, h, view, canvas, getImagePath) {
  if (view.kind === 'gift_voucher') return drawGiftVoucher(ctx, w, h, view, canvas, getImagePath)
  if (view.kind === 'gift_holder') return drawGiftHolderCert(ctx, w, h, view, canvas, getImagePath)
  return drawHolderCert(ctx, w, h, view, canvas, getImagePath)
}

module.exports = {
  drawCertificate,
  drawHolderCert,
  drawGiftHolderCert,
  drawGiftVoucher
}
