-- Marca deixada pelo filtro automático (documento 02, §6.2)
ALTER TABLE "Book" ADD COLUMN "filterFlag" "FilterSeverity";

-- Inserir e remover páginas desloca os índices em dois passos, passando por valores acima de 999.
-- O limite de páginas continua garantido por "Book_page_count".
ALTER TABLE "Page" DROP CONSTRAINT "Page_index";
ALTER TABLE "Page" ADD CONSTRAINT "Page_index" CHECK ("index" >= 0);
