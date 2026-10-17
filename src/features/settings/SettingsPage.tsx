// The settings page.
//
// Everything here is honest surface over existing commands: the theme switch
// writes through ThemeModeProvider (localStorage + MUI) and the store (the
// durable app_settings row), backups call the Rust ZIP pipeline, and the
// dangerous zone asks for typed confirmation before touching the database.

import { useEffect, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Link from '@mui/material/Link';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import BackupIcon from '@mui/icons-material/Backup';
import RestoreIcon from '@mui/icons-material/Restore';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useAppStore } from '../../state/appStore';
import { useThemeMode } from '../../theme/ThemeModeProvider';
import { appInfo, purgeAllData, seedDevData, type AppInfo } from '../../lib/commands';
import {
  backupToFile,
  chooseAndInspect,
  restoreFromFile,
} from '../../lib/backup';
import type { BackupManifest } from '../../lib/commands';

/** A backup chosen for restore, already inspected and found compatible. */
interface ChosenBackup {
  path: string;
  manifest: BackupManifest;
  inspection: import('../../lib/commands').BackupInspection;
}
import { t } from '../../i18n/th';
import { ConfirmDialog, useUndoSnackbar } from '../../components';

type ThemeMode = 'light' | 'dark' | 'system';

export function SettingsPage(): ReactNode {
  const saveSetting = useAppStore((s) => s.saveSetting);
  const reload = useAppStore((s) => s.reload);
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const { notify, element: snackbar } = useUndoSnackbar();

  const [info, setInfo] = useState<AppInfo | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [restoreRecord, setRestoreRecord] = useState<ChosenBackup | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    appInfo()
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch(() => {
        // The About card simply shows less without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const path = await backupToFile();
      if (path !== null) notify(t('settings.backupSuccess', { path }));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('errors.saveFailed'));
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestore = async () => {
    if (restoreRecord === null) return;
    setRestoring(true);
    try {
      await restoreFromFile(restoreRecord.path, info?.version ?? '');
      notify(t('settings.restoreSuccess'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('settings.restoreFailed'));
    } finally {
      setRestoring(false);
      setRestoreRecord(null);
    }
  };

  const handlePurge = async () => {
    setPurging(true);
    try {
      await purgeAllData();
      await reload();
      setPurgeOpen(false);
      notify(t('settings.purgeAllData'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('errors.deleteFailed'));
    } finally {
      setPurging(false);
    }
  };

  const handleSeed = async () => {
    try {
      const result = await seedDevData();
      await reload();
      setSeedOpen(false);
      notify(
        t('settings.seedDataDone', {
          count:
            result.accounts + result.snapshots + result.transactions + result.budgets,
        }),
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : t('errors.saveFailed'));
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h1">
        {t('settings.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('settings.subtitle')}
      </Typography>

      <Stack spacing={2}>
        {/* ── appearance ─────────────────────────────────────────────── */}
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              {t('settings.appearance')}
            </Typography>
            <FormControl>
              <FormLabel>{t('settings.themeMode')}</FormLabel>
              <RadioGroup
                row
                value={themeMode}
                onChange={(_event, value) => {
                  const next = value as ThemeMode;
                  setThemeMode(next);
                  void saveSetting('themeMode', next);
                }}
              >
                <FormControlLabel value="light" control={<Radio />} label={t('settings.themeLight')} />
                <FormControlLabel value="dark" control={<Radio />} label={t('settings.themeDark')} />
                <FormControlLabel value="system" control={<Radio />} label={t('settings.themeSystem')} />
              </RadioGroup>
            </FormControl>
          </CardContent>
        </Card>

        {/* ── data ───────────────────────────────────────────────────── */}
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              {t('settings.data')}
            </Typography>
            {info !== null && (
              <>
                <TextField
                  fullWidth
                  label={t('settings.databasePath')}
                  value={info.database_path}
                  slotProps={{ input: { readOnly: true } }}
                  sx={{ mb: 2 }}
                />
                <Button
                  startIcon={<FolderOpenIcon />}
                  onClick={() => {
                    void import('@tauri-apps/plugin-opener').then((m) =>
                      m.openPath(info.database_path.replace(/[/\\][^/\\]+$/, '')),
                    );
                  }}
                  sx={{ mb: 2 }}
                >
                  {t('settings.openDatabaseFolder')}
                </Button>
              </>
            )}
            <CardActions disableSpacing sx={{ px: 0 }}>
              <Button
                variant="contained"
                startIcon={<BackupIcon />}
                onClick={() => {
                  void handleBackup();
                }}
                disabled={backingUp}
              >
                {t('settings.backupNow')}
              </Button>
              <Button
                startIcon={<RestoreIcon />}
                onClick={() => {
                  void chooseAndInspect().then((result) => {
                    if (result !== null) {
                      const { path, inspection } = result;
                      if (!inspection.compatible) {
                        notify(inspection.reason ?? t('settings.restoreIncompatible'));
                        return;
                      }
                      setRestoreRecord({
                        path,
                        manifest: inspection.manifest,
                        inspection,
                      });
                    }
                  });
                }}
                disabled={restoring}
                sx={{ ml: 1 }}
              >
                {t('settings.restoreChoose')}
              </Button>
            </CardActions>
            <Typography variant="caption" color="text.secondary" component="div">
              {t('settings.backupNowHint')}
            </Typography>
          </CardContent>
        </Card>

        {/* ── privacy ────────────────────────────────────────────────── */}
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              {t('settings.privacy')}
            </Typography>
            <Alert severity="success" icon={false} sx={{ mb: 1 }}>
              <Typography variant="subtitle2" component="div">
                {t('settings.privacyTitle')}
              </Typography>
              <Typography variant="body2" component="div">
                {t('settings.privacyBody')}
              </Typography>
            </Alert>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Chip size="small" label={t('settings.noTelemetry')} />
              <Chip size="small" label={t('settings.noNetwork')} />
              <Chip size="small" label={t('settings.noBankSync')} />
              <Chip size="small" label={t('settings.localOnly')} />
            </Stack>
          </CardContent>
        </Card>

        {/* ── about ──────────────────────────────────────────────────── */}
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              {t('settings.about')}
            </Typography>
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('settings.appVersion')}:
                </Typography>
                <Typography variant="body2">{info?.version ?? '…'}</Typography>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('settings.schemaVersion')}:
                </Typography>
                <Typography variant="body2">{info?.schema_version ?? '…'}</Typography>
              </Stack>
              {info !== null && info.repository_url !== '' && (
                <Link href={info.repository_url} target="_blank" rel="noreferrer">
                  {t('settings.openRepository')}
                </Link>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Divider />

        {/* ── dangerous zone ─────────────────────────────────────────── */}
        <Card sx={{ borderColor: 'error.main' }}>
          <CardContent>
            <Typography variant="h6" component="h2" color="error" gutterBottom>
              {t('settings.dangerousZone')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('settings.purgeAllDataHint')}
            </Typography>
            <Button color="error" variant="outlined" onClick={() => { setPurgeOpen(true); }}>
              {t('settings.purgeAllData')}
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 1 }}>
              {t('settings.seedDataHint')}
            </Typography>
            <Button onClick={() => { setSeedOpen(true); }}>
              {t('settings.seedData')}
            </Button>
          </CardContent>
        </Card>
      </Stack>

      {/* Restore inspection + typed confirmation */}
      <RestoreDialog
        record={restoreRecord}
        restoring={restoring}
        onConfirm={() => {
          void handleRestore();
        }}
        onClose={() => {
          setRestoreRecord(null);
        }}
      />
      <ConfirmDialog
        open={purgeOpen}
        title={t('settings.purgeAllData')}
        body={t('settings.purgeAllDataHint')}
        danger
        requirePhrase={t('settings.purgeAllConfirm')}
        busy={purging}
        onConfirm={() => {
          void handlePurge();
        }}
        onClose={() => {
          setPurgeOpen(false);
        }}
      />
      <ConfirmDialog
        open={seedOpen}
        title={t('settings.seedDataConfirm')}
        body={t('settings.seedDataHint')}
        busy={false}
        onConfirm={() => {
          void handleSeed();
        }}
        onClose={() => {
          setSeedOpen(false);
        }}
      />
      {snackbar}
    </Box>
  );
}

import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';

interface RestoreDialogProps {
  record: ChosenBackup | null;
  restoring: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function RestoreDialog({ record, restoring, onConfirm, onClose }: RestoreDialogProps): ReactNode {
  return (
    <Dialog open={record !== null} onClose={restoring ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('settings.restoreConfirmTitle')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" component="div" sx={{ mb: 1 }}>
          {t('settings.restoreConfirmBody')}
        </Typography>
        {record !== null && (
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            <Typography variant="body2">
              {record.manifest.app_name} {record.manifest.app_version}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('settings.backupCreatedAt')}: {record.manifest.created_at}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('settings.backupSchema')}: {record.manifest.schema_version}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('settings.backupCounts')}: {record.manifest.counts.accounts} /{' '}
              {record.manifest.counts.snapshots} / {record.manifest.counts.transactions}
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={restoring}>
          {t('app.cancel')}
        </Button>
        <Button onClick={onConfirm} color="error" variant="contained" disabled={restoring}>
          {t('settings.confirmRestore')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
