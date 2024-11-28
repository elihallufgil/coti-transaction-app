import { BaseEntity } from './base.entity';
import { Column, Entity, EntityManager, JoinColumn, ManyToOne } from 'typeorm';
import { TableNames } from './table-names';
import { ActionsEntity } from './actions.entity';
import { ActionEnum } from '../enums/action.enum';
import { AccountsEntity } from './accounts.entity';
import { Logger } from '@nestjs/common';

@Entity(TableNames.ACTIVITIES)
export class ActivitiesEntity extends BaseEntity {
  @Column()
  transactionId: number;

  @Column()
  tokenId: number;

  @Column()
  actionId: number;

  @Column()
  from: string;

  @Column()
  to: string;

  @Column()
  data: string;

  @ManyToOne(() => ActionsEntity)
  @JoinColumn({ name: 'actionId' })
  action: ActionsEntity;

  @ManyToOne(() => AccountsEntity)
  @JoinColumn({ name: 'to', referencedColumnName: 'address' })
  toAccount: AccountsEntity;
}

export const createActivityEntity = async (
  manager: EntityManager,
  activity?: Partial<ActivitiesEntity>,
): Promise<ActivitiesEntity> => {
  const newActivity = manager.create(ActivitiesEntity, activity);
  return manager.save(newActivity);
};

export const getLastHourActivityPerAction = async (
  manager: EntityManager,
): Promise<Map<ActionEnum, number>> => {
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);
  const activitiesRepository = manager.getRepository(ActivitiesEntity);
  const res = await activitiesRepository
    .createQueryBuilder('activities')
    .innerJoin(ActionsEntity, 'actions', 'actions.id = activities.actionId')
    .select('actions.type', 'actionType')
    .addSelect('COUNT(activities.id)', 'activityCount')
    .where('activities.createTime >= :oneHourAgo', { oneHourAgo })
    .groupBy('actions.type')
    .getRawMany<{ activityCount: number; actionType: ActionEnum }>();
  const actionToActivityCountMap = new Map<ActionEnum, number>();
  for (const rec of res) {
    actionToActivityCountMap.set(rec.actionType, rec.activityCount);
  }
  return actionToActivityCountMap;
};

export const getAccountIndexesThatReceiveToken = async (
  manager: EntityManager,
  tokenId: number,
  isPrivate?: boolean,
): Promise<number[]> => {
  const logger = new Logger('getAccountIndexesThatReceiveToken');
  const activitiesRepository = manager.getRepository(ActivitiesEntity);
  const query = activitiesRepository
    .createQueryBuilder('activities')
    .leftJoin(AccountsEntity, 'accounts', 'accounts.address = activities.to')
    .select('accounts.index', 'accountIndex')
    .where('activities.tokenId = :tokenId', { tokenId })
    .andWhere('activities.to IS NOT NULL')
    .andWhere(`${isPrivate ? 'accounts.networkAesKey IS NOT NULL' : '1=1'}`)
    .groupBy('accounts.index')
    .getQuery();
  logger.warn(query);
  const res = await activitiesRepository
    .createQueryBuilder('activities')
    .leftJoin(AccountsEntity, 'accounts', 'accounts.address = activities.to')
    .select('accounts.index', 'accountIndex')
    .where('activities.tokenId = :tokenId', { tokenId })
    .andWhere('activities.to IS NOT NULL')
    .andWhere(`${isPrivate ? 'accounts.networkAesKey IS NOT NULL' : '1=1'}`)
    .groupBy('accounts.index')
    .getRawMany<{ accountIndex: number }>();
  return res.map((x) => x.accountIndex);
};
