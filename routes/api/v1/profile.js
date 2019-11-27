const express = require('express');
const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');

const multer = require('multer');
const authService = require('../../../services/auth-service');

const {
  createCard,
  createCustomer,
} = require('../../../services/stripe-service');
const { isLoggedIn } = require('../../../passport');
const { editProfileValidation } = require('../../../validation');

// multer & GCS

const gcStorage = require('../../../gcs/multer-gcs');
const { deleteFile } = require('../../../services/gcs-service');

const storage = gcStorage({
  prefix: 'nadiia/avatars',
  size: {
    width: 180,
    height: 180,
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1000 * 1000 * 5,
  },
});

// models
const { Article } = require('../../../models/sequelize');
const { ArticlesView } = require('../../../models/mongoose');

// logger
const { infoLogger } = require('../../../logger/logger');

const router = express.Router();

/**
 * @route   PUT api/v1/profile
 * @desc    Update user profile: change first name or last name
 */

router.put(
  '/',
  editProfileValidation,
  isLoggedIn,
  asyncHandler(async (req, res, next) => {
    const { id } = req.user;

    const userData = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
    };

    // MySQL operations: find user and update
    await req.user.update(userData);

    // logging success
    infoLogger.log({
      level: 'info',
      message: `User ${id} was successfully updated`,
    });

    res.json({ data: req.user });
  }),
);

/**
 * @route   DELETE api/v1/profile
 * @desc    Delete user
 */

router.delete(
  '/',
  isLoggedIn,
  asyncHandler(async (req, res, next) => {
    const { id } = req.user;

    const oldProfilePicture = req.user.picture;

    // find all articles pictures to delete them
    let articlesPictures = await Article.findAll({
      where: {
        authorId: id,
        picture: {
          [Op.not]: null,
        },
      },
      raw: true,
      attributes: ['picture'],
    });
    articlesPictures = articlesPictures.map((i) => i.picture);

    // MySQL operations: delete user record
    const destroyed = await req.user.destroy();

    // delete profile picture
    if (oldProfilePicture) {
      await deleteFile(oldProfilePicture);
    }

    // delete articles pictures
    if (articlesPictures.length) {
      await Promise.all(articlesPictures.map((url) => deleteFile(url)));
    }

    // MongoDB operations: delete docs from articlesviews collection
    await ArticlesView.deleteMany({
      authorId: id,
    });

    // logging success
    infoLogger.log({
      level: 'info',
      message: `User ${id} was successfully deleted`,
    });

    await authService.logout(req, res, next);
  }),
);

/**
 * @route   PUT api/v1/profile/picture
 * @desc    Put user profile picture
 */

router.put(
  '/picture',
  isLoggedIn,
  upload.single('picture'),
  asyncHandler(async (req, res, next) => {
    const { id } = req.user;

    const userData = {
      picture: req.file.url,
    };

    const oldPicture = req.user.picture;

    // MySQL operations: update user
    await req.user.update(userData);

    // logging success
    infoLogger.log({
      level: 'info',
      message: `User's ${id} picture was successfully updated`,
    });

    // delete old profile picture
    if (oldPicture) {
      await deleteFile(oldPicture);
    }

    res.json({ data: { picture: req.user.picture } });
  }),
);

/**
 * @route   PUT api/v1/profile/card
 * @desc    Create user's stripe card
 */

router.put(
  '/card',
  isLoggedIn,
  asyncHandler(async (req, res, next) => {
    const { token } = req.body;
    const { user } = req;

    let customerId = user.stripe_customer_id;
    const updateData = {};

    // create stripe customer for user if it doesn't exist
    if (!customerId) {
      customerId = await createCustomer(user.email);
      updateData.stripe_customer_id = customerId;
    }

    // create stripe card
    const cardId = await createCard(token, customerId);
    updateData.stripe_card_id = cardId;

    // MySQL operation: save card id  and stripe customer id for the current user
    await user.update(updateData);

    // send response
    res.json({ data: user });
  }),
);

module.exports = router;
