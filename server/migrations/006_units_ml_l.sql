-- Unidades de volume: mililitro e litro (litro já existe em bases novas; não duplica).
INSERT INTO units_of_measure (code, name)
SELECT v.code, v.name FROM (VALUES ('ML','Mililitro'),('L','Litro')) AS v(code, name)
WHERE NOT EXISTS (SELECT 1 FROM units_of_measure u WHERE lower(u.code) = lower(v.code));
