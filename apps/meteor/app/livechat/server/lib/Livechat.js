// Note: Please don't add any new methods to this file, since its still in js and we are migrating to ts
// Please add new methods to LivechatTyped.ts
import { Logger } from '@rocket.chat/logger';
import { LivechatCustomField, LivechatRooms, LivechatInquiry, Subscriptions, Rooms } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { Apps, AppEvents } from '../../../../ee/server/apps';
import { callbacks } from '../../../../lib/callbacks';
import { trim } from '../../../../lib/utils/stringUtils';
import { i18n } from '../../../../server/lib/i18n';
import { hasPermissionAsync } from '../../../authorization/server/functions/hasPermission';
import { Analytics } from './Analytics';

const logger = new Logger('Livechat');

export const Livechat = {
	Analytics,

	logger,

	async saveRoomInfo(roomData, guestData, userId) {
		Livechat.logger.debug(`Saving room information on room ${roomData._id}`);
		const { livechatData = {} } = roomData;
		const customFields = {};

		if ((!userId || (await hasPermissionAsync(userId, 'edit-livechat-room-customfields'))) && Object.keys(livechatData).length) {
			Livechat.logger.debug(`Updating custom fields on room ${roomData._id}`);
			const fields = LivechatCustomField.findByScope('room');
			for await (const field of fields) {
				if (!livechatData.hasOwnProperty(field._id)) {
					continue;
				}
				const value = trim(livechatData[field._id]);
				if (value !== '' && field.regexp !== undefined && field.regexp !== '') {
					const regexp = new RegExp(field.regexp);
					if (!regexp.test(value)) {
						throw new Meteor.Error(i18n.t('error-invalid-custom-field-value', { field: field.label }));
					}
				}
				customFields[field._id] = value;
			}
			roomData.livechatData = customFields;
			Livechat.logger.debug(`About to update ${Object.keys(customFields).length} custom fields on room ${roomData._id}`);
		}

		if (!(await LivechatRooms.saveRoomById(roomData))) {
			Livechat.logger.debug(`Failed to save room information on room ${roomData._id}`);
			return false;
		}

		setImmediate(() => {
			Apps.triggerEvent(AppEvents.IPostLivechatRoomSaved, roomData._id);
		});
		callbacks.runAsync('livechat.saveRoom', roomData);

		if (guestData?.name?.trim().length) {
			const { _id: rid } = roomData;
			const { name } = guestData;
			return (
				(await Rooms.setFnameById(rid, name)) &&
				(await LivechatInquiry.setNameByRoomId(rid, name)) &&
				// This one needs to be the last since the agent may not have the subscription
				// when the conversation is in the queue, then the result will be 0(zero)
				Subscriptions.updateDisplayNameByRoomId(rid, name)
			);
		}
	},
};
