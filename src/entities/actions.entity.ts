import { BaseEntity } from './base.entity';
import { Column, Entity, EntityManager } from 'typeorm';
import { TableNames } from './table-names';
import { exec } from '../utils/helpers';
import { AppStatesEntity } from './app-states.entity';
import { ActionEnum } from '../enums/action.enum';

@Entity(TableNames.ACTIONS)
export class ActionsEntity extends BaseEntity {
  @Column()
  type: string;

  @Column()
  randomRange: number;
}

export const getActionByType = async (
  manager: EntityManager,
  type: ActionEnum,
): Promise<ActionsEntity> => {
  return manager.findOne(ActionsEntity, { where: { type } });
};

export const getAllActions = async (
  manager: EntityManager,
): Promise<ActionsEntity[]> => {
  return manager.find(ActionsEntity);
};
