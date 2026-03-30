const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_in_prod';

// Register specific errors for better client feedback
const handleErrors = (err) => {
    console.log(err.message, err.code);
    let errors = { username: '', email: '', password: '' };

    // Duplicate error code
    if (err.code === 11000) {
        if (err.message.includes('email')) {
            errors.email = 'That email is already registered';
        }
        if (err.message.includes('username')) {
            errors.username = 'That username is already taken';
        }
        return errors;
    }

    // Validation errors
    if (err.message.includes('User validation failed')) {
        Object.values(err.errors).forEach(({ properties }) => {
            errors[properties.path] = properties.message;
        });
    }

    return errors;
};

const maxAge = 3 * 24 * 60 * 60; // 3 days in seconds
const createToken = (id) => {
    return jwt.sign({ id }, JWT_SECRET, {
        expiresIn: maxAge
    });
};

module.exports.signup_post = async (req, res) => {
    const { username, email, password } = req.body;

    try {
        // Hash password before saving (could also be done in pre-save hook)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({ username, email, password: hashedPassword });
        const token = createToken(user._id);

        res.status(201).json({ user: user._id, token, username: user.username });
    }
    catch (err) {
        const errors = handleErrors(err);
        res.status(400).json({ errors });
    }
}

module.exports.login_post = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (user) {
            const auth = await bcrypt.compare(password, user.password);
            if (auth) {
                const token = createToken(user._id);
                res.status(200).json({ user: user._id, token, username: user.username });
                return;
            }
            throw Error('incorrect password');
        }
        throw Error('incorrect email');
    }
    catch (err) {
        let errors = { email: '', password: '' };
        if (err.message === 'incorrect email') {
            errors.email = 'That email is not registered';
        }
        if (err.message === 'incorrect password') {
            errors.password = 'That password is incorrect';
        }
        res.status(400).json({ errors });
    }
}

module.exports.get_users_get = async (req, res) => {
    try {
        const users = await User.find({}, { username: 1, email: 1, _id: 1 });
        res.status(200).json(users);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch users" });
    }
}
