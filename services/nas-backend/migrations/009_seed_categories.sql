-- 009_seed_categories.sql — bilingual taxonomy seed.
--
-- A small, hand-curated taxonomy is shipped in the migration so a
-- fresh install has a non-empty category tree to attach books to.
-- The categories follow the path convention ``/<top>/<sub>[/<sub>]``
-- so the recursive CTE in the categories repository has something
-- interesting to walk in the e2e tests.
--
-- Every row is guarded by a ``WHERE NOT EXISTS`` check on the unique
-- ``path`` column, making this migration idempotent. The seed must
-- remain small — anything larger belongs in a content import script
-- that runs separately.
--
-- The seed is split into two statements: the INSERT populates rows
-- in arbitrary order, and the subsequent UPDATE wires ``parent_id``
-- via the path → parent_path relationship declared in the same
-- VALUES table. Using two statements (instead of one giant CTE)
-- keeps the SQL Postgres-compatible without relying on
-- data-modifying CTE semantics that vary across versions.

INSERT INTO categories (path, name_es, name_en, depth)
SELECT * FROM (VALUES
  ('/ciencia',                                 'Ciencia',     'Science',     0),
  ('/ciencia/biologia',                        'Biología',    'Biology',     1),
  ('/ciencia/quimica',                         'Química',     'Chemistry',   1),
  ('/ciencia/biologia/zoologia',               'Zoología',    'Zoology',     2),
  ('/ciencia/biologia/botanica',               'Botánica',    'Botany',      2),
  ('/arte',                                    'Arte',        'Art',         0),
  ('/arte/pintura',                            'Pintura',     'Painting',    1),
  ('/arte/escultura',                          'Escultura',   'Sculpture',   1),
  ('/literatura',                              'Literatura',  'Literature',  0),
  ('/literatura/novela',                       'Novela',      'Novel',       1),
  ('/literatura/ensayo',                       'Ensayo',      'Essay',       1)
) AS seed(path, name_es, name_en, depth)
WHERE NOT EXISTS (
  SELECT 1 FROM categories WHERE categories.path = seed.path
);

-- Wire up ``parent_id`` after the rows exist. The parent path is
-- derived by stripping the trailing ``/<segment>`` from the child
-- path with ``regexp_replace``. Top-level rows end up with
-- ``parent_id IS NULL`` because the regex leaves no match.
UPDATE categories
SET parent_id = parent.id
FROM categories parent
WHERE categories.parent_id IS NULL
  AND parent.path = regexp_replace(categories.path, '/[^/]+$', '')
  AND parent.id <> categories.id;