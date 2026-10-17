// Small sx helpers shared by the components.
//
// MUI's full `SxProps` union resists being spread through an array without
// unsafe-spread complaints, and pages only ever pass plain style objects.
// `SxStyle` is the type the components accept; `sxFragment` turns an optional
// one into an array fragment safe to spread into an `sx` array.

import type { CSSObject } from '@mui/material/styles';

/** A plain style object — what pages pass for the optional `sx` prop. */
export type SxStyle = CSSObject;

/** Flattens an optional `sx` object into an array fragment safe to spread. */
export function sxFragment(sx: SxStyle | undefined): SxStyle[] {
  return sx === undefined ? [] : [sx];
}

/** Read by a screen reader, invisible on screen. */
export const visuallyHidden: SxStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
