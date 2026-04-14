const { PrismaClient } = require('@prisma/client');

async function checkOrg() {
  const prisma = new PrismaClient();
  
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'demo@eavesight.com' },
      include: { organizationMemberships: { include: { organization: true } } }
    });
    
    console.log('User organization memberships:');
    user.organizationMemberships.forEach(membership => {
      console.log('- Organization: ' + membership.organization.name + ' (ID: ' + membership.organizationId + ')');
    });
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkOrg();