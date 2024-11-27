import { BaseEntity } from './base.entity';
import { Column, Entity, EntityManager } from 'typeorm';
import { TableNames } from './table-names';

@Entity(TableNames.TOKENS_TO_GENERATE)
export class TokensToGenerateEntity extends BaseEntity {
  @Column()
  name: string;

  @Column()
  symbol: string;

  @Column()
  isGenerated: boolean;
}

export const getTokenToGenerate = async (
  manager: EntityManager,
): Promise<TokensToGenerateEntity | null> => {
  return manager.findOne(TokensToGenerateEntity, {
    where: { isGenerated: false },
  });
};

export const insertManyTokensToGenerate = async (
  manager: EntityManager,
  tokens: { name: string; symbol: string }[],
) => {
  return manager.insert(
    TokensToGenerateEntity,
    tokens.map((t) => manager.create(TokensToGenerateEntity, t)),
  );
};
