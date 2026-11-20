-- Optional starter catalog. Run after migrations. Safe to run more than once.
INSERT INTO "Branch" ("id", "code", "name") VALUES
('a1111111-1111-4111-8111-111111111111', 'CENTRO', 'Bistro Centro'),
('a2222222-2222-4222-8222-222222222222', 'NORTE', 'Bistro Norte'),
('a3333333-3333-4333-8333-333333333333', 'JARDIN', 'Bistro Jardín')
ON CONFLICT DO NOTHING;

-- This account has no password and cannot sign in. It owns the starter menu records.
INSERT INTO "User" ("id", "role", "branchId")
SELECT 'b1111111-1111-4111-8111-111111111111', 'MANAGER', b."id"
FROM "Branch" b WHERE b."code" = 'CENTRO'
ON CONFLICT DO NOTHING;

INSERT INTO "Table" ("id", "branchId", "number", "status")
SELECT gen_random_uuid(), b."id", n.number, 'AVAILABLE'::"TableStatus"
FROM "Branch" b
CROSS JOIN (VALUES (1), (2), (3)) AS n(number)
WHERE b."code" IN ('CENTRO', 'NORTE', 'JARDIN')
ON CONFLICT ("branchId", "number") DO NOTHING;

INSERT INTO "MenuItem" ("id", "branchId", "name", "normalizedName", "description", "category", "price", "isAvailable", "createdById", "updatedAt")
SELECT gen_random_uuid(), b."id", d.name, d.normalized_name, d.description, d.category::"MenuCategory", d.price, true,
'b1111111-1111-4111-8111-111111111111', NOW()
FROM "Branch" b
CROSS JOIN (VALUES
('Bruschetta de tomate', 'bruschetta de tomate', 'Pan tostado, tomate fresco y albahaca.', 'STARTER', 6.50),
('Ensalada de la casa', 'ensalada de la casa', 'Hojas frescas, vegetales de temporada y vinagreta.', 'STARTER', 7.25),
('Pasta al pesto', 'pasta al pesto', 'Pasta fresca con pesto de albahaca y parmesano.', 'MAIN_COURSE', 13.50),
('Pollo a la parrilla', 'pollo a la parrilla', 'Pollo dorado con vegetales asados.', 'MAIN_COURSE', 15.00),
('Limonada fresca', 'limonada fresca', 'Limón natural y hielo.', 'DRINK', 3.50),
('Tarta de chocolate', 'tarta de chocolate', 'Chocolate intenso con crema suave.', 'DESSERT', 6.00)
) AS d(name, normalized_name, description, category, price)
WHERE b."code" IN ('CENTRO', 'NORTE', 'JARDIN')
ON CONFLICT ("branchId", "normalizedName") DO NOTHING;
