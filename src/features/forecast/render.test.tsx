import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ForecastPage } from './ForecastPage';

// Regression guard: the forecast page must render without throwing. It used
// to crash on mount by passing a full date key into `addMonthsKey`.
describe('ForecastPage render', () => {
  it('renders with an empty store without crashing', () => {
    const { container } = render(<ForecastPage />);
    expect(container).toBeTruthy();
  });
});
