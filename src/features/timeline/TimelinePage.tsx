// The timeline page — the core of the app.
//
// Lists every balance snapshot across every account, newest first, with the
// derived delta and its classification status. All arithmetic comes from the
// store's snapshot rows, which Rust recalculated in a transaction at write
// time; this page only filters and displays.
//
// Filters follow the spec exactly: account, date range, category, update type,
// and classified/unclassified status. The FilterBar supplies the first two and
// the search box; the selects below extend it for the rest.

import { useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LabelOutlineIcon from '@mui/icons-material/LabelOutlined';
import { useAppStore, accountById, categoryById } from '../../state/appStore';
import type { TimelineEntry } from '../../db/repositories/snapshots';
import { deleteSnapshot, saveSnapshot, classifySnapshot, CommandError } from '../../lib/commands';
import type { UpdateType } from '../../domain/snapshots';
import { UPDATE_TYPES, compareNewestFirst } from '../../domain/snapshots';
import { formatThaiDateTime, formatRelativeThai, bangkokDateKey } from '../../domain/dates';
import { t } from '../../i18n/th';
import {
  BalanceText,
  ChangeText,
  ConfirmDialog,
  EmptyState,
  FilterBar,
  useUndoSnackbar,
} from '../../components';
import { SnapshotDialog } from './SnapshotDialog';
import { ClassifyDialog } from './ClassifyDialog';

interface Filters {
  search: string;
  accountId: number | 'all';
  range: { start: string; end: string } | null;
  categoryId: number | 'none' | 'all';
  updateType: UpdateType | 'all';
  classified: 'all' | 'classified' | 'unclassified';
}

const NO_FILTERS: Filters = {
  search: '',
  accountId: 'all',
  range: null,
  categoryId: 'all',
  updateType: 'all',
  classified: 'all',
};

export function TimelinePage(): ReactNode {
  const state = useAppStore();
  const { notify, element: snackbar } = useUndoSnackbar();

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TimelineEntry | null>(null);
  const [classifyTarget, setClassifyTarget] = useState<TimelineEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TimelineEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const hasFilter =
    filters.search !== '' ||
    filters.accountId !== 'all' ||
    filters.range !== null ||
    filters.categoryId !== 'all' ||
    filters.updateType !== 'all' ||
    filters.classified !== 'all';

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const matching = state.snapshots.filter((snapshot) => {
      if (filters.accountId !== 'all' && snapshot.accountId !== filters.accountId) return false;
      if (filters.updateType !== 'all' && snapshot.updateType !== filters.updateType) return false;
      if (filters.categoryId !== 'all') {
        if (filters.categoryId === 'none') {
          if (snapshot.categoryId !== null) return false;
        } else if (snapshot.categoryId !== filters.categoryId) {
          return false;
        }
      }
      if (filters.classified !== 'all') {
        const isClassified = snapshot.isClassified;
        if (filters.classified === 'classified' && !isClassified) return false;
        if (filters.classified === 'unclassified' && isClassified) return false;
      }
      if (filters.range !== null) {
        const dateKey = bangkokDateKey(snapshot.effectiveAt);
        if (dateKey < filters.range.start || dateKey > filters.range.end) return false;
      }
      if (search !== '') {
        const account = accountById(state, snapshot.accountId);
        const category = categoryById(state, snapshot.categoryId);
        const haystack = [account?.name, category?.name, snapshot.note]
          .filter((part): part is string => part !== undefined && part !== null)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    // The store keeps snapshots chronological for the arithmetic; this list is
    // display only, so it sorts newest first per the spec.
    return [...matching].sort(compareNewestFirst);
  }, [state, filters]);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (snapshot: TimelineEntry) => {
    setEditing(snapshot);
    setDialogOpen(true);
  };

  const handleSave = async (
    draft: Parameters<typeof saveSnapshot>[0],
    id: number | null,
  ): Promise<void> => {
    try {
      const result = await saveSnapshot({ ...draft, id: id ?? undefined });
      await useAppStore.getState().reload();
      if (result.recalculated > 0) {
        notify(t('timeline.recalculatedNotice', { count: result.recalculated }));
      } else {
        notify(t('app.save'));
      }
    } catch (error) {
      throw error instanceof CommandError ? error : new Error(t('errors.saveFailed'));
    }
  };

  const handleClassify = async (values: {
    updateType: UpdateType;
    categoryId: number | null;
    note: string | null;
  }): Promise<void> => {
    if (classifyTarget === null) return;
    try {
      const result = await classifySnapshot(
        classifyTarget.accountId,
        classifyTarget.id,
        values.updateType,
        values.categoryId,
        values.note,
      );
      await useAppStore.getState().reload();
      if (result.recalculated > 0) {
        notify(t('timeline.recalculatedNotice', { count: result.recalculated }));
      }
      setClassifyTarget(null);
    } catch (error) {
      throw error instanceof CommandError ? error : new Error(t('errors.saveFailed'));
    }
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    setDeleting(true);
    try {
      const accountId = deleteTarget.accountId;
      await deleteSnapshot(accountId, deleteTarget.id);
      await useAppStore.getState().reload();
      setDeleteTarget(null);
      notify(t('app.delete'));
    } catch (error) {
      notify(error instanceof CommandError ? error.message : t('errors.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">
            {t('timeline.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('timeline.subtitle')}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
          {t('timeline.addSnapshot')}
        </Button>
      </Stack>

      <FilterBar
        search={filters.search}
        onSearch={(search) => {
          setFilters((f) => ({ ...f, search }));
        }}
        accountId={filters.accountId}
        onAccount={(accountId) => {
          setFilters((f) => ({ ...f, accountId }));
        }}
        accounts={state.accounts.filter((a) => !a.isArchived)}
        range={filters.range}
        onRange={(range) => {
          setFilters((f) => ({ ...f, range }));
        }}
      >
        <TextField
          select
          size="small"
          sx={{ minWidth: 180 }}
          label={t('timeline.category')}
          value={
            filters.categoryId === 'all'
              ? 'all'
              : filters.categoryId === 'none'
                ? 'none'
                : String(filters.categoryId)
          }
          onChange={(event) => {
            const value = event.target.value;
            setFilters((f) => ({
              ...f,
              categoryId: value === 'all' || value === 'none' ? value : Number(value),
            }));
          }}
        >
          <MenuItem value="all">{t('app.all')}</MenuItem>
          <MenuItem value="none">{t('app.none')}</MenuItem>
          {state.categories
            .filter((c) => !c.isArchived)
            .map((category) => (
              <MenuItem key={category.id} value={String(category.id)}>
                {category.name}
              </MenuItem>
            ))}
        </TextField>
        <TextField
          select
          size="small"
          sx={{ minWidth: 160 }}
          label={t('timeline.updateType')}
          value={filters.updateType}
          onChange={(event) => {
            const value = event.target.value;
            setFilters((f) => ({
              ...f,
              updateType: value === 'all' ? 'all' : (value as UpdateType),
            }));
          }}
        >
          <MenuItem value="all">{t('app.all')}</MenuItem>
          {UPDATE_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {t(`updateType.${type}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          sx={{ minWidth: 170 }}
          label={t('timeline.classified')}
          value={filters.classified}
          onChange={(event) => {
            const value = event.target.value;
            setFilters((f) => ({
              ...f,
              classified: value as Filters['classified'],
            }));
          }}
        >
          <MenuItem value="all">{t('app.all')}</MenuItem>
          <MenuItem value="classified">{t('timeline.classified')}</MenuItem>
          <MenuItem value="unclassified">{t('timeline.unclassified')}</MenuItem>
        </TextField>
      </FilterBar>

      <Box sx={{ mb: 1 }}>
        {hasFilter && (
          <Button
            size="small"
            onClick={() => {
              setFilters(NO_FILTERS);
            }}
          >
            {t('app.clearFilter')}
          </Button>
        )}
      </Box>

      {state.snapshots.length === 0 ? (
        <EmptyState
          title={t('timeline.noSnapshots')}
          hint={t('timeline.noSnapshotsHint')}
          action={
            <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
              {t('timeline.addSnapshot')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title={t('timeline.noSnapshotsForFilter')} />
      ) : (
        <Stack spacing={1.5}>
          {filtered.map((snapshot) => (
            <TimelineRow
              key={snapshot.id}
              snapshot={snapshot}
              onEdit={() => {
                openEdit(snapshot);
              }}
              onClassify={() => {
                setClassifyTarget(snapshot);
              }}
              onDelete={() => {
                setDeleteTarget(snapshot);
              }}
            />
          ))}
        </Stack>
      )}

      <SnapshotDialog
        open={dialogOpen}
        accounts={state.accounts.filter((a) => !a.isArchived)}
        categories={state.categories}
        snapshot={editing}
        onClose={() => {
          setDialogOpen(false);
        }}
        onSaved={() => {
          /* notifications handled in handleSave */
        }}
        onSave={handleSave}
      />
      <ClassifyDialog
        open={classifyTarget !== null}
        categories={state.categories}
        snapshotId={classifyTarget?.id ?? 0}
        deltaSatang={classifyTarget?.derivedDeltaSatang ?? 0}
        currentType={classifyTarget?.updateType ?? 'unknown'}
        currentCategoryId={classifyTarget?.categoryId ?? null}
        currentNote={classifyTarget?.note ?? null}
        onClose={() => {
          setClassifyTarget(null);
        }}
        onSave={handleClassify}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('timeline.deleteConfirmTitle')}
        body={t('timeline.deleteConfirmBody')}
        danger
        busy={deleting}
        onConfirm={() => {
          void handleDelete();
        }}
        onClose={() => {
          setDeleteTarget(null);
        }}
      />
      {snackbar}
    </Box>
  );
}

interface TimelineRowProps {
  snapshot: TimelineEntry;
  onEdit: () => void;
  onClassify: () => void;
  onDelete: () => void;
}

function TimelineRow({ snapshot, onEdit, onClassify, onDelete }: TimelineRowProps): ReactNode {
  const state = useAppStore();
  const account = accountById(state, snapshot.accountId);
  const category = categoryById(state, snapshot.categoryId);
  const unclassified = !snapshot.isClassified;

  return (
    <Card variant="outlined" sx={{ bgcolor: unclassified ? 'action.hover' : undefined }}>
      <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography variant="subtitle1" component="span" sx={{ fontWeight: 600 }}>
              {account?.name ?? `#${snapshot.accountId}`}
            </Typography>
            <Chip
              size="small"
              label={t(`updateType.${snapshot.updateType}`)}
              variant="outlined"
            />
            {category !== undefined && <Chip size="small" label={category.name} />}
            {unclassified && (
              <Tooltip title={t('timeline.unclassifiedExplain')}>
                <Chip
                  size="small"
                  color="warning"
                  variant="filled"
                  label={t('timeline.unclassifiedBadge')}
                  aria-label={t('a11y.unclassifiedBadgeLabel')}
                />
              </Tooltip>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {formatThaiDateTime(snapshot.effectiveAt)} · {formatRelativeThai(snapshot.effectiveAt)}
          </Typography>
          {snapshot.note !== null && snapshot.note !== '' && (
            <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
              {snapshot.note}
            </Typography>
          )}
        </Box>
        <Box sx={{ textAlign: 'end', flexShrink: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {t('timeline.balanceAfter')}
          </Typography>
          <BalanceText satang={snapshot.balanceSatang} size="h5" />
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {t('timeline.derivedDelta')}
          </Typography>
          <ChangeText satang={snapshot.derivedDeltaSatang} />
        </Box>
        <Stack sx={{ flexShrink: 0 }}>
          <Tooltip title={t('timeline.editSnapshot')}>
            <IconButton size="small" onClick={onEdit} aria-label={t('timeline.editSnapshot')}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {unclassified && (
            <Tooltip title={t('timeline.classifyNow')}>
              <IconButton
                size="small"
                onClick={onClassify}
                aria-label={t('timeline.classifyNow')}
                color="warning"
              >
                <LabelOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('app.delete')}>
            <IconButton size="small" onClick={onDelete} aria-label={t('app.delete')}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </CardContent>
    </Card>
  );
}

