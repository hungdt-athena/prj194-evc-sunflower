/**
 * Đọc dữ liệu thô từ Google Sheets bằng service account.
 * Tầng này không biết gì về DB hay nghiệp vụ: nó chỉ trả về mảng object theo header.
 */

const { google } = require('googleapis');

const RAW_RANGE = 'raw!A:M';
const REVIEWED_RANGE = 'reviewed!A:K';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

function rowsToObjects(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const [header, ...rows] = values;
  return rows.map(row => {
    const obj = {};
    header.forEach((key, i) => { obj[key] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

/**
 * Nhận credential theo hai đường: đường dẫn file (máy local) hoặc nội dung JSON
 * (Replit và các nơi chỉ có biến môi trường, không commit được file key).
 */
function createClient({ keyFile, credentialsJson }) {
  if (credentialsJson) {
    let credentials;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch (err) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ' + err.message);
    }
    return google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({ credentials, scopes: SCOPES }) });
  }
  if (!keyFile) {
    throw new Error('No credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON (on Replit: add the secret, then Republish so the deployment reloads it)');
  }
  return google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({ keyFile, scopes: SCOPES }) });
}

async function fetchSheetRows({ sheetId, keyFile, credentialsJson, client }) {
  const sheets = client || createClient({ keyFile, credentialsJson });
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: [RAW_RANGE, REVIEWED_RANGE],
  });
  const [rawRange = {}, reviewedRange = {}] = res.data.valueRanges || [];
  return {
    raw: rowsToObjects(rawRange.values),
    reviewed: rowsToObjects(reviewedRange.values),
  };
}

module.exports = { rowsToObjects, fetchSheetRows, createClient, RAW_RANGE, REVIEWED_RANGE };
