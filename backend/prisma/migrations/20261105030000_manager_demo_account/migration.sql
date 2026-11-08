-- Demo manager for the Centro branch. Only the salted password hash is stored.
INSERT INTO "User" ("id", "email", "passwordHash", "role", "branchId")
SELECT 'd7777777-7777-4777-8777-777777777777', 'gerente.centro@bistro.demo',
  'scrypt$780d7480c06be549aac80d5836d10a4d$7c114f4320ea121867aea21a58c01629d7faa2e18307df2cdcb0fbb8951da2bd90547bc20e92e8fba867f821e4d791eac421ed69ba560ba904ec0e89bd85f75a',
  'MANAGER'::"Role", branch."id"
FROM "Branch" branch
WHERE branch."code" = 'CENTRO'
ON CONFLICT DO NOTHING;
