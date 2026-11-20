-- Demo staff accounts; only salted scrypt hashes are stored.
INSERT INTO "User" ("id", "email", "passwordHash", "role", "branchId")
SELECT 'd1111111-1111-4111-8111-111111111111', 'mesero@bistro.demo',
'scrypt$b2ed5e83c1a30e22e5fb869d1fa5140a$7ebdfec1298601b73dd99e5cde871c17aaa546bd49f4f3c6f2fb6f1675eaec6f301944ec13072ea01392d65ace2c263bb9a023db1d54a4ce33588fd96df7d5ce',
'WAITER'::"Role", b."id" FROM "Branch" b WHERE b."code" = 'CENTRO'
ON CONFLICT DO NOTHING;

INSERT INTO "User" ("id", "email", "passwordHash", "role", "branchId")
SELECT 'd2222222-2222-4222-8222-222222222222', 'cocina@bistro.demo',
'scrypt$1722d278d03265da924824eff5821533$0e5c75515e7849f19409c5786ab0451e32a6ecfefeda7e03299c10c079eafc412e1bbf770147426d0fac91451c2f44e32974d4925a8aa10ea156e12d6a67c10b',
'KITCHEN'::"Role", b."id" FROM "Branch" b WHERE b."code" = 'CENTRO'
ON CONFLICT DO NOTHING;
