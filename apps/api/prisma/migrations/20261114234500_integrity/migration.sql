-- Regras de integridade que o Prisma não gera (documento 02, §2.5).

-- Rascunho é sempre privado
ALTER TABLE "Book" ADD CONSTRAINT "Book_draft_is_private"
  CHECK ("status" <> 'DRAFT' OR "visibility" = 'PRIVATE');
ALTER TABLE "Book" ADD CONSTRAINT "Book_page_count" CHECK ("pageCount" BETWEEN 1 AND 1000);

-- Cópia do original (1) ou cópia da cópia (2), como no jogo
ALTER TABLE "BookCopy" ADD CONSTRAINT "BookCopy_generation" CHECK ("generation" IN (1, 2));

-- Rede de segurança: a API já valida com o packages/shared. char_length conta code points, então
-- nunca recusa o que a API aceitou (a API conta unidades UTF-16, que são iguais ou mais).
ALTER TABLE "Page" ADD CONSTRAINT "Page_content_length" CHECK (char_length("content") <= 1024);
ALTER TABLE "Page" ADD CONSTRAINT "Page_index" CHECK ("index" BETWEEN 0 AND 999);

-- Par de amizade em ordem canônica: uma linha por par
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_canonical" CHECK ("userAId" < "userBId");
ALTER TABLE "Block" ADD CONSTRAINT "Block_not_self" CHECK ("blockerId" <> "blockedId");

-- Assinar trava o livro (D7): as páginas de um livro assinado não mudam, nem pela API nem por SQL.
-- Na exclusão em cascata o livro já não existe quando as páginas saem, então ela passa.
CREATE FUNCTION qf_page_guard() RETURNS trigger AS $$
DECLARE
  book_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN book_id := OLD."bookId"; ELSE book_id := NEW."bookId"; END IF;
  IF EXISTS (SELECT 1 FROM "Book" WHERE "id" = book_id AND "status" = 'SIGNED') THEN
    RAISE EXCEPTION 'signed books cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Page_signed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "Page"
  FOR EACH ROW EXECUTE FUNCTION qf_page_guard();

-- Um livro assinado nunca volta a ser rascunho
CREATE FUNCTION qf_book_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'SIGNED' AND NEW."status" <> 'SIGNED' THEN
    RAISE EXCEPTION 'signed books cannot become drafts' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Book_signed_guard"
  BEFORE UPDATE ON "Book"
  FOR EACH ROW EXECUTE FUNCTION qf_book_guard();

-- Busca por similaridade em títulos e usernames (documento 02, §3.7)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Book_title_trgm" ON "Book" USING gin ("title" gin_trgm_ops);
CREATE INDEX "User_username_trgm" ON "User" USING gin ("usernameLower" gin_trgm_ops);
