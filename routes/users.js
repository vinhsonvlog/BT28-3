var express = require("express");
var router = express.Router();
let { validatedResult, CreateAnUserValidator, ModifyAnUserValidator } = require('../utils/validator')
let userModel = require("../schemas/users");
let userController = require('../controllers/users')
let { CheckLogin, CheckRole } = require('../utils/authHandler')
let roleModel = require('../schemas/roles')
let { uploadExcel } = require('../utils/uploadHandler')
let exceljs = require('exceljs')
let path = require('path')
let crypto = require('crypto')
let { sendImportedUserMail } = require('../utils/mailHandler')

function generateRandomPassword(length = 16) {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const number = '0123456789';
  const symbol = '!@#$%^&*()-_=+[]{}';
  const allChars = upper + lower + number + symbol;

  let passwordChars = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    number[crypto.randomInt(0, number.length)],
    symbol[crypto.randomInt(0, symbol.length)],
  ];

  while (passwordChars.length < length) {
    passwordChars.push(allChars[crypto.randomInt(0, allChars.length)]);
  }

  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
  }

  return passwordChars.join('');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.get("/", CheckLogin,CheckRole("ADMIN", "USER"), async function (req, res, next) {
    let users = await userModel
      .find({ isDeleted: false })
    res.send(users);
  });

router.get("/:id", async function (req, res, next) {
  try {
    let result = await userModel
      .find({ _id: req.params.id, isDeleted: false })
    if (result.length > 0) {
      res.send(result);
    }
    else {
      res.status(404).send({ message: "id not found" });
    }
  } catch (error) {
    res.status(404).send({ message: "id not found" });
  }
});

router.post('/import', CheckLogin, CheckRole('ADMIN'), uploadExcel.single('file'), async function (req, res, next) {
  if (!req.file) {
    return res.status(400).send({
      message: 'file khong duoc de trong'
    });
  }

  try {
    let userRole = await roleModel.findOne({
      isDeleted: false,
      name: { $regex: /^user$/i }
    });

    if (!userRole) {
      return res.status(404).send({ message: 'khong tim thay role user' });
    }

    let workbook = new exceljs.Workbook();
    let pathFile = path.join(__dirname, '../uploads', req.file.filename);
    await workbook.xlsx.readFile(pathFile);
    let worksheet = workbook.worksheets[0];

    if (!worksheet) {
      return res.status(400).send({ message: 'file excel khong hop le' });
    }

    let existedUsers = await userModel.find({ isDeleted: false }).select('username email');
    let usernameSet = new Set(existedUsers.map(u => String(u.username).toLowerCase()));
    let emailSet = new Set(existedUsers.map(u => String(u.email).toLowerCase()));

    let result = [];
    for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex++) {
      let row = worksheet.getRow(rowIndex);
      let username = row.getCell(1).text.trim();
      let email = row.getCell(2).text.trim().toLowerCase();
      let errors = [];

      if (!username) {
        errors.push('username khong duoc de trong');
      } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        errors.push('username khong hop le');
      }

      if (!email) {
        errors.push('email khong duoc de trong');
      } else if (!isValidEmail(email)) {
        errors.push('email sai dinh dang');
      }

      if (username && usernameSet.has(username.toLowerCase())) {
        errors.push('username da ton tai');
      }

      if (email && emailSet.has(email)) {
        errors.push('email da ton tai');
      }

      if (errors.length > 0) {
        result.push({
          row: rowIndex,
          status: 'failed',
          errors: errors
        });
        continue;
      }

      let plainPassword = generateRandomPassword(16);

      try {
        let newUser = new userModel({
          username: username,
          password: plainPassword,
          email: email,
          role: userRole._id
        });

        await newUser.save();
        await sendImportedUserMail(email, username, plainPassword);

        usernameSet.add(username.toLowerCase());
        emailSet.add(email);

        result.push({
          row: rowIndex,
          status: 'success',
          user: {
            id: newUser._id,
            username: newUser.username,
            email: newUser.email,
            role: 'user'
          }
        });
      } catch (error) {
        result.push({
          row: rowIndex,
          status: 'failed',
          errors: [error.message]
        });
      }
    }

    res.send(result);
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
});

router.post("/", CreateAnUserValidator, validatedResult, async function (req, res, next) {
  try {
    let newItem = await userController.CreateAnUser(
      req.body.username, req.body.password, req.body.email, req.body.role,
      req.body.fullName, req.body.avatarUrl, req.body.status, req.body.loginCount)
    res.send(newItem);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

router.put("/:id", ModifyAnUserValidator, validatedResult, async function (req, res, next) {
  try {
    let id = req.params.id;
    let updatedItem = await userModel.findByIdAndUpdate(id, req.body, { new: true });

    if (!updatedItem) return res.status(404).send({ message: "id not found" });

    let populated = await userModel
      .findById(updatedItem._id)
    res.send(populated);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

router.delete("/:id", async function (req, res, next) {
  try {
    let id = req.params.id;
    let updatedItem = await userModel.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true }
    );
    if (!updatedItem) {
      return res.status(404).send({ message: "id not found" });
    }
    res.send(updatedItem);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

module.exports = router;