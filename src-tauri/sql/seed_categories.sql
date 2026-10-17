-- Default Thai categories.
--
-- Kept in its own file because it is applied twice: once by migration 0001 on a
-- fresh database, and again by the `purge_all_data` command when the user asks
-- to start over. Categories are seed data, not user data — a wiped database
-- should still be immediately usable, so they are restored rather than left
-- empty.
--
-- `position` is contiguous within each `kind`, because the UI's reorder action
-- swaps neighbours by position.

INSERT INTO categories (name, kind, icon, color, position) VALUES
  ('เงินเดือน',          'income',  'payments',          '#2E7D32', 0),
  ('รายได้เสริม',        'income',  'work',              '#388E3C', 1),
  ('ดอกเบี้ย',           'income',  'savings',           '#43A047', 2),
  ('เงินคืน',            'income',  'replay',            '#4CAF50', 3),
  ('อื่น ๆ',             'income',  'more_horiz',        '#66BB6A', 4),
  ('อาหารและเครื่องดื่ม', 'expense', 'restaurant',        '#E65100', 0),
  ('เดินทาง',            'expense', 'directions_car',    '#F57C00', 1),
  ('ที่อยู่อาศัย',        'expense', 'home',              '#FB8C00', 2),
  ('ค่าสาธารณูปโภค',     'expense', 'bolt',              '#FFA726', 3),
  ('ช้อปปิ้ง',           'expense', 'shopping_bag',      '#D81B60', 4),
  ('สุขภาพ',             'expense', 'health_and_safety', '#C2185B', 5),
  ('ความบันเทิง',        'expense', 'movie',             '#AD1457', 6),
  ('การศึกษา',           'expense', 'school',            '#8E24AA', 7),
  ('ประกัน',             'expense', 'shield',            '#5E35B1', 8),
  ('หนี้สิน',            'expense', 'credit_card',       '#3949AB', 9),
  ('ค่าธรรมเนียม',       'expense', 'receipt_long',      '#1E88E5', 10),
  ('อื่น ๆ',             'expense', 'more_horiz',        '#546E7A', 11);
