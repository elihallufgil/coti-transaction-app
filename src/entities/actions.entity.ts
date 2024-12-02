import { BaseEntity } from './base.entity';
import { Column, Entity, EntityManager } from 'typeorm';
import { TableNames } from './table-names';
import { ActionEnum } from '../enums/action.enum';

@Entity(TableNames.ACTIONS)
export class ActionsEntity extends BaseEntity {
  @Column()
  type: ActionEnum;

  @Column()
  randomRange: number;

  @Column()
  maxPerHour: number;
}

export const getActionByType = async (
  manager: EntityManager,
  type: ActionEnum,
  lock = false,
): Promise<ActionsEntity> => {
  const query = manager
    .getRepository<ActionsEntity>(TableNames.ACTIONS)
    .createQueryBuilder(TableNames.ACTIONS)
    .where({ type });
  if (lock) {
    query.setLock('pessimistic_write');
  }
  return query.getOne();
};

export const getAllActions = async (
  manager: EntityManager,
): Promise<ActionsEntity[]> => {
  return manager.find(ActionsEntity);
};

export const getActions = async (
  manager: EntityManager,
): Promise<ActionsEntity[]> => {
  return manager.find(ActionsEntity);
};
