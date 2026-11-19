import { S } from './state.js';
import { todayISO } from '../utils/helpers.js';

// ============ EXPORT / IMPORT ============
export function exportData() {
  const blob = new Blob([JSON.stringify(S.state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `pragma-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importData() {
  document.getElementById('fileInput').click();
}
