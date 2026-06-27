/**
 * Provider token for the sagas repository inside the books module.
 *
 * The books detail response embeds the sagas a book belongs to.
 * Exposing the token here lets tests inject an in-memory stub
 * while keeping the production wiring unchanged.
 */
export const SAGAS_REPOSITORY = 'SAGAS_REPOSITORY';

export {
  Saga,
  NewSaga,
  BookSagaLink,
  SagasRepository,
  PgSagasRepository,
  createSagasRepository,
} from '../repositories/sagas.repository';