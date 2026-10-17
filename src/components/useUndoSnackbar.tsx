// Undo snackbar wiring.
//
// The spec asks for undo on destructive-but-recoverable actions (archive,
// delete with a recalculation that can be re-entered). This module is the thin
// piece of state every page shares: it owns one snackbar at a time, and a new
// action replaces the old one rather than queueing.

import { useCallback, useState } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { t } from '../i18n/th';

/** How long the user has to change their mind. */
const UNDO_WINDOW_MS = 7000;

export interface UndoState {
  message: string;
  onUndo: () => void;
}

/**
 * Snackbar + undo, one at a time.
 *
 * `notify` shows a message; `notifyUndo` shows one with an undo button and a
 * deadline. The undo callback runs once and then the snackbar closes — it is
 * not re-armed, so a stale closure cannot fire twice.
 */
export function useUndoSnackbar(): {
  notify: (message: string) => void;
  notifyUndo: (message: string, onUndo: () => void) => void;
  element: React.ReactNode;
} {
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const notify = useCallback((message: string) => {
    setUndo(null);
    setPlain(message);
    setOpen(true);
  }, []);

  const notifyUndo = useCallback((message: string, onUndo: () => void) => {
    setPlain(null);
    setUndo({ message, onUndo });
    setOpen(true);
  }, []);

  const close = useCallback(() => { setOpen(false); }, []);

  const element = (
    <Snackbar
      open={open}
      autoHideDuration={undo !== null ? UNDO_WINDOW_MS : 4000}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        onClose={close}
        severity={undo !== null ? 'info' : 'success'}
        variant="filled"
        action={
          undo !== null ? (
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                undo.onUndo();
                close();
              }}
            >
              {t('app.undo')}
            </Button>
          ) : undefined
        }
        sx={{ minWidth: 280 }}
      >
        {undo !== null ? undo.message : (plain ?? '')}
      </Alert>
    </Snackbar>
  );

  return { notify, notifyUndo, element };
}
