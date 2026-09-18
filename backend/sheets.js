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

function createClient(keyFile) {
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
  return google.sheets({ version: 'v4', auth });
}

async function fetchSheetRows({ sheetId, keyFile, client }) {
  const sheets = client || createClient(keyFile);
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
