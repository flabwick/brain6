require('dotenv').config();
const User = require('./src/models/User');
const { healthCheck, checkTables, closePool } = require('./src/models/database');

async function testUserModel() {
  try {
    console.log('🏥 Testing database health...');
    const isHealthy = await healthCheck();
    if (!isHealthy) {
      throw new Error('Database is not healthy');
    }
    console.log('✅ Database is healthy');

    console.log('📋 Checking database tables...');
    const tableStatus = await checkTables();
    if (!tableStatus.allExist) {
      console.log('⚠️  Missing tables:', tableStatus.missing);
      throw new Error('Required tables are missing');
    }
    console.log('✅ All required tables exist');

    console.log('👤 Testing User model...');
    
    // Test user creation
    console.log('Creating test user...');
    const testUser = await User.create('testuser', 'testpassword123');
    console.log('✅ User created:', testUser.username);

    // Test user lookup
    console.log('Finding user by username...');
    const foundUser = await User.findByUsername('testuser');
    console.log('✅ User found:', foundUser ? foundUser.username : 'null');

    // Test password verification
    console.log('Testing password verification...');
    const isValidPassword = await foundUser.verifyPassword('testpassword123');
    const isInvalidPassword = await foundUser.verifyPassword('wrongpassword');
    console.log('✅ Password verification:', { valid: isValidPassword, invalid: !isInvalidPassword });

    // Test listing users
    console.log('Listing all users...');
    const allUsers = await User.findAll();
    console.log('✅ Total users:', allUsers.length);

    // Clean up - delete test user
    console.log('Cleaning up test user...');
    await testUser.delete();
    console.log('✅ Test user deleted');

    console.log('🎉 All User model tests passed!');

  } catch (error) {
    console.error('❌ User model test failed:', error.message);
    console.error(error.stack);
  } finally {
    await closePool();
  }
}

testUserModel();