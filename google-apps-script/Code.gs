const COMMENT_SHEET_NAME = '종목 코멘트';
const COMMENT_HEADERS = ['등록 시각', '티커', '닉네임', '코멘트'];

function doPost(event) {
  try {
    const payload = JSON.parse(event?.postData?.contents || '{}');
    const scriptProperties = PropertiesService.getScriptProperties();
    const expectedSecret = scriptProperties.getProperty('SHARED_SECRET');
    const spreadsheetId = scriptProperties.getProperty('SPREADSHEET_ID');
    if (!expectedSecret || !spreadsheetId || payload.secret !== expectedSecret) {
      return jsonResponse({ ok: false, message: 'Unauthorized' });
    }

    const ticker = String(payload.ticker || '').trim().toUpperCase();
    const name = String(payload.name || '익명').trim().slice(0, 40) || '익명';
    const comment = String(payload.comment || '').trim();
    if (!/^[A-Z][A-Z0-9.^-]{0,14}$/.test(ticker) || comment.length < 2 || comment.length > 1000) {
      return jsonResponse({ ok: false, message: 'Invalid comment' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      let sheet = spreadsheet.getSheetByName(COMMENT_SHEET_NAME);
      if (!sheet) sheet = spreadsheet.insertSheet(COMMENT_SHEET_NAME);
      if (sheet.getLastRow() === 0) sheet.appendRow(COMMENT_HEADERS);
      sheet.appendRow([new Date(), safeCell(ticker), safeCell(name), safeCell(comment)]);
    } finally {
      lock.releaseLock();
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, message: 'Unable to save comment' });
  }
}

function safeCell(value) {
  const text = String(value || '').trim();
  return /^[=+@-]/.test(text) ? `'${text}` : text;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}