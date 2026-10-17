// Confirmation dialog, including the typed-confirmation variant.
//
// Every destructive action in the app goes through this. The typed variant is
// for the irreversible ones: the confirm button stays disabled until the user
// types the exact phrase, which is the spec's "typed confirmation" requirement
// rather than a checkbox they can tap through.

import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { t } from '../i18n/th';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button; on for anything destructive. */
  danger?: boolean;
  /** When set, the user must type this exact phrase to enable the button. */
  requirePhrase?: string;
  /** Label above the phrase field. */
  phraseLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Disables confirm while an async action is in flight. */
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  requirePhrase,
  phraseLabel,
  onConfirm,
  onClose,
  busy = false,
}: ConfirmDialogProps): ReactNode {
  // The typed phrase resets whenever the dialog is unmounted or re-keyed for a
  // different confirmation; the parent supplies the key, so no effect is
  // needed to clear it.
  const [phrase, setPhrase] = useState('');
  const [lastOpen, setLastOpen] = useState(open);
  if (open && !lastOpen) setPhrase('');
  if (open !== lastOpen) setLastOpen(open);
  const matches = requirePhrase === undefined || phrase === requirePhrase;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{body}</DialogContentText>
        {requirePhrase !== undefined && (
          <TextField
            autoFocus
            fullWidth
            margin="normal"
            label={phraseLabel ?? t('confirm.typeName', { name: requirePhrase })}
            value={phrase}
            onChange={(event) => { setPhrase(event.target.value); }}
            error={phrase !== '' && !matches}
            helperText={phrase !== '' && !matches ? t('confirm.mismatch') : undefined}
            disabled={busy}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => {
          onClose();
        }} disabled={busy}>
          {cancelLabel ?? t('app.cancel')}
        </Button>
        <Button
          onClick={onConfirm}
          color={danger ? 'error' : 'primary'}
          variant="contained"
          disabled={!matches || busy}
        >
          {confirmLabel ?? t('app.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
