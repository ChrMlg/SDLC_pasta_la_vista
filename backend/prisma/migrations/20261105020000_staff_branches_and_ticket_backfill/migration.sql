-- Branch-scoped demo staff for the other starter locations. Passwords are salted hashes.
INSERT INTO "User" ("id", "email", "passwordHash", "role", "branchId")
SELECT staff.id::uuid, staff.email, staff.password_hash, staff.role::"Role", branch."id"
FROM (VALUES
('d3333333-3333-4333-8333-333333333333', 'mesero.norte@bistro.demo', 'scrypt$76abf17b79cf6e5326f2ae41980a0d82$0adf965607cf33e7937cad1dafcbe0937ed775d8fd5eb616342fad03f7c2ed31fb0f9634dc32071b919cc31eeb2ddd2c866da3fb11ded2298736362637b60f99', 'WAITER', 'NORTE'),
('d4444444-4444-4444-8444-444444444444', 'cocina.norte@bistro.demo', 'scrypt$c2746d46aabdaed51c92e70003b02394$2e69bf6b0617e6017ac567c598251dba40f5c7f7db731ec9ab5fa85ca4e6e2511117d3fcee9f825163f554a98df8df4ad014c2cc06e28352b431da4affe58107', 'KITCHEN', 'NORTE'),
('d5555555-5555-4555-8555-555555555555', 'mesero.jardin@bistro.demo', 'scrypt$4974080a3da8512a87e453152449ffc4$89820a48313192506e9f092d4ba53bb035cd43ee3c0bab5b2f0b82eb1459a656c573ea8518592a7af1354cf0147d70334cc8927b552519b1b05ca17d4458e685', 'WAITER', 'JARDIN'),
('d6666666-6666-4666-8666-666666666666', 'cocina.jardin@bistro.demo', 'scrypt$3ad7f450c8df75211d1ba9e53afd4310$73a76b436c659071564e9d88bdb1f122dcacb6429c7e4f42228285e640021413061667f41bd2ad0823e33056dd465f01aebccd5d3e8f2d28630271988f1ff911', 'KITCHEN', 'JARDIN')
) AS staff(id, email, password_hash, role, branch_code)
JOIN "Branch" branch ON branch."code" = staff.branch_code
ON CONFLICT DO NOTHING;

-- Repair DINE_IN tickets if any orders were recorded before ticket creation was enabled.
-- TAKEAWAY remains outside the kitchen queue until an approved payment creates its ticket.
INSERT INTO "KitchenTicket" ("id", "orderId", "status", "createdAt")
SELECT gen_random_uuid(), orders."id", orders."status", orders."createdAt"
FROM "Order" orders
WHERE orders."type" = 'DINE_IN' AND orders."status" <> 'CANCELLED'
ON CONFLICT ("orderId") DO NOTHING;
