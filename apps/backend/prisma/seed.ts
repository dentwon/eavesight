import { PrismaClient, StormType, Severity } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Eavesight database...');

  // Create demo user
  const passwordHash = await bcrypt.hash('demo1234', 12);
  const user = await prisma.user.upsert({
    where: { email: 'demo@eavesight.com' },
    update: {},
    create: {
      email: 'demo@eavesight.com',
      passwordHash,
      firstName: 'Demo',
      lastName: 'User',
    },
  });
  console.log('✅ Created demo user: demo@eavesight.com / demo1234');

  // Create organization
  const org = await prisma.organization.upsert({
    where: { id: 'demo-org' },
    update: {},
    create: {
      id: 'demo-org',
      name: "Demo Roofing Co",
    },
  });
  console.log('✅ Created organization:', org.name);

  // Add user to organization
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      userId: user.id,
      role: 'OWNER',
    },
  });
  console.log('✅ Added user to organization');

  // Create storm events for North Alabama / Huntsville area
  const stormData = [
    // 2024 storms
    { type: StormType.HAIL, severity: Severity.SEVERE, date: new Date('2024-04-02'), county: 'Madison', city: 'Huntsville', geom: { lat: 34.7304, lon: -86.5854 }, state: 'AL', description: 'Severe hail storm with 2" hail' },
    { type: StormType.HAIL, severity: Severity.MODERATE, date: new Date('2024-04-02'), county: 'Madison', city: 'Hazel Green', geom: { lat: 34.7431, lon: -86.5689 }, state: 'AL', description: 'Moderate hail reported' },
    { type: StormType.HAIL, severity: Severity.SEVERE, date: new Date('2024-04-02'), county: 'Madison', city: 'Meridianville', geom: { lat: 34.7634, lon: -86.6150 }, state: 'AL', description: 'Severe hail with wind damage' },
    { type: StormType.TORNADO, severity: Severity.EXTREME, date: new Date('2024-03-25'), county: 'Madison', city: 'Huntsville', geom: { lat: 34.7250, lon: -86.5600 }, state: 'AL', description: 'EF-2 tornado touched down' },
    { type: StormType.WIND, severity: Severity.SEVERE, date: new Date('2024-05-15'), county: 'Madison', city: 'New Hope', geom: { lat: 34.5387, lon: -86.3980 }, state: 'AL', description: 'Severe wind gusts 70+ mph' },
    { type: StormType.HAIL, severity: Severity.LIGHT, date: new Date('2024-06-08'), county: 'Madison', city: 'Gurley', geom: { lat: 34.7034, lon: -86.3744 }, state: 'AL', description: 'Light hail, minor damage' },
    { type: StormType.WIND, severity: Severity.MODERATE, date: new Date('2024-07-22'), county: 'Limestone', city: 'Athens', geom: { lat: 34.8034, lon: -86.9717 }, state: 'AL', description: 'Moderate wind damage to roofs' },
    { type: StormType.HAIL, severity: Severity.SEVERE, date: new Date('2024-08-03'), county: 'Madison', city: 'Toney', geom: { lat: 34.7131, lon: -86.7367 }, state: 'AL', description: 'Severe hail 1.5" diameter' },
    { type: StormType.TSTM, severity: Severity.MODERATE, date: new Date('2024-09-12'), county: 'Madison', city: 'Huntsville', geom: { lat: 34.7400, lon: -86.5900 }, state: 'AL', description: 'Thunderstorm winds causing damage' },
    // 2025 storms
    { type: StormType.HAIL, severity: Severity.SEVERE, date: new Date('2025-03-15'), county: 'Madison', city: 'Huntsville', geom: { lat: 34.7100, lon: -86.6200 }, state: 'AL', description: 'Severe hail storm, golf ball sized hail' },
    { type: StormType.WIND, severity: Severity.SEVERE, date: new Date('2025-04-20'), county: 'Limestone', city: 'Madison', geom: { lat: 34.6993, lon: -86.7281 }, state: 'AL', description: 'Straight line winds causing extensive damage' },
    { type: StormType.HAIL, severity: Severity.MODERATE, date: new Date('2025-05-10'), county: 'Madison', city: 'Harvest', geom: { lat: 34.7900, lon: -86.7500 }, state: 'AL', description: 'Quarter sized hail reported' },
    // 2026 storms (recent)
    { type: StormType.HAIL, severity: Severity.SEVERE, date: new Date('2026-02-14'), county: 'Madison', city: 'Huntsville', geom: { lat: 34.6800, lon: -86.5500 }, state: 'AL', description: 'Severe hail storm, tennis ball sized' },
    { type: StormType.WIND, severity: Severity.MODERATE, date: new Date('2026-03-01'), county: 'Madison', city: 'New Market', geom: { lat: 34.9084, lon: -86.4317 }, state: 'AL', description: 'Moderate storm damage' },
    { type: StormType.HAIL, severity: Severity.LIGHT, date: new Date('2026-03-10'), county: 'Madison', city: 'Brownsboro', geom: { lat: 34.7400, lon: -86.4700 }, state: 'AL', description: 'Light hail, no significant damage' },
  ];

  let stormsCreated = 0;
  for (const data of stormData) {
    const existing = await prisma.stormEvent.findFirst({
      where: {
        date: data.date,
        county: data.county,
        city: data.city,
        type: data.type,
      },
    });
    if (!existing) {
      await prisma.stormEvent.create({ data });
      stormsCreated++;
    }
  }
  console.log(`✅ Created ${stormsCreated} storm events`);

  // Create sample properties in Huntsville area
  const propertyData = [
    { address: '123 Oak Street', city: 'Huntsville', state: 'AL', zip: '35801', lat: 34.7250, lon: -86.5800, yearBuilt: 1985, roofAge: 18 },
    { address: '456 Maple Avenue', city: 'Huntsville', state: 'AL', zip: '35801', lat: 34.7300, lon: -86.5850, yearBuilt: 1992, roofAge: 8 },
    { address: '789 Pine Road', city: 'Huntsville', state: 'AL', zip: '35802', lat: 34.7350, lon: -86.5900, yearBuilt: 1978, roofAge: 22 },
    { address: '321 Cedar Lane', city: 'Madison', state: 'AL', zip: '35758', lat: 34.6993, lon: -86.7281, yearBuilt: 2005, roofAge: 12 },
    { address: '654 Elm Court', city: 'Madison', state: 'AL', zip: '35758', lat: 34.7050, lon: -86.7200, yearBuilt: 2010, roofAge: 5 },
    { address: '987 Birch Drive', city: 'Huntsville', state: 'AL', zip: '35803', lat: 34.6500, lon: -86.5500, yearBuilt: 1998, roofAge: 15 },
    { address: '147 Willow Way', city: 'Huntsville', state: 'AL', zip: '35810', lat: 34.7800, lon: -86.6000, yearBuilt: 1982, roofAge: 25 },
    { address: '258 Spruce Circle', city: 'Hazel Green', state: 'AL', zip: '35750', lat: 34.7431, lon: -86.5689, yearBuilt: 2000, roofAge: 10 },
    { address: '369 Aspen Boulevard', city: 'Meridianville', state: 'AL', zip: '35759', lat: 34.7634, lon: -86.6150, yearBuilt: 2015, roofAge: 3 },
    { address: '741 Redwood Terrace', city: 'Huntsville', state: 'AL', zip: '35811', lat: 34.8000, lon: -86.5500, yearBuilt: 1975, roofAge: 30 },
    { address: '852 Poplar Street', city: 'Athens', state: 'AL', zip: '35611', lat: 34.8034, lon: -86.9717, yearBuilt: 1990, roofAge: 20 },
    { address: '963 Hickory Lane', city: 'Huntsville', state: 'AL', zip: '35805', lat: 34.7100, lon: -86.6400, yearBuilt: 1988, roofAge: 16 },
    { address: '159 Sycamore Drive', city: 'Madison', state: 'AL', zip: '35758', lat: 34.6800, lon: -86.7100, yearBuilt: 2018, roofAge: 2 },
    { address: '267 Chestnut Court', city: 'New Hope', state: 'AL', zip: '35760', lat: 34.5387, lon: -86.3980, yearBuilt: 1995, roofAge: 14 },
    { address: '378 Walnut Road', city: 'Gurley', state: 'AL', zip: '35748', lat: 34.7034, lon: -86.3744, yearBuilt: 2003, roofAge: 11 },
  ];

  let propertiesCreated = 0;
  for (const data of propertyData) {
    const existing = await prisma.property.findFirst({
      where: { address: data.address, city: data.city, state: data.state },
    });
    if (!existing) {
      await prisma.property.create({ data });
      propertiesCreated++;
    }
  }
  console.log(`✅ Created ${propertiesCreated} properties`);

  // Create some sample leads
  const leadData = [
    { firstName: 'John', lastName: 'Smith', email: 'john.smith@email.com', phone: '256-555-0101', status: 'NEW', priority: 'HIGH', address: '123 Oak Street', city: 'Huntsville', state: 'AL', zip: '35801' },
    { firstName: 'Sarah', lastName: 'Johnson', email: 'sarah.j@email.com', phone: '256-555-0102', status: 'CONTACTED', priority: 'MEDIUM', address: '456 Maple Avenue', city: 'Huntsville', state: 'AL', zip: '35801' },
    { firstName: 'Michael', lastName: 'Williams', email: 'mwilliams@email.com', phone: '256-555-0103', status: 'QUALIFIED', priority: 'HIGH', address: '789 Pine Road', city: 'Huntsville', state: 'AL', zip: '35802' },
    { firstName: 'Emily', lastName: 'Brown', email: 'emily.brown@email.com', phone: '256-555-0104', status: 'QUOTED', priority: 'MEDIUM', address: '321 Cedar Lane', city: 'Madison', state: 'AL', zip: '35758' },
    { firstName: 'David', lastName: 'Davis', email: 'david.d@email.com', phone: '256-555-0105', status: 'NEGOTIATING', priority: 'HIGH', address: '654 Elm Court', city: 'Madison', state: 'AL', zip: '35758' },
    { firstName: 'Jennifer', lastName: 'Miller', email: 'jmiller@email.com', phone: '256-555-0106', status: 'WON', priority: 'MEDIUM', address: '987 Birch Drive', city: 'Huntsville', state: 'AL', zip: '35803' },
    { firstName: 'Robert', lastName: 'Wilson', email: 'rwilson@email.com', phone: '256-555-0107', status: 'NEW', priority: 'LOW', address: '147 Willow Way', city: 'Huntsville', state: 'AL', zip: '35810' },
    { firstName: 'Lisa', lastName: 'Taylor', email: 'lisa.t@email.com', phone: '256-555-0108', status: 'CONTACTED', priority: 'MEDIUM', address: '852 Poplar Street', city: 'Athens', state: 'AL', zip: '35611' },
  ];

  let leadsCreated = 0;
  for (const data of leadData) {
    // Find property
    const property = await prisma.property.findFirst({
      where: { address: data.address, city: data.city, state: data.state },
    });

    const existing = await prisma.lead.findFirst({
      where: { orgId: org.id, phone: data.phone },
    });

    if (!existing) {
      await prisma.lead.create({
        data: {
          orgId: org.id,
          propertyId: property?.id,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          status: data.status as any,
          priority: data.priority as any,
          source: 'Map Search',
          notes: `Interested in roof inspection after recent storms. ${data.status === 'WON' ? 'Signed contract!' : 'Following up.'}`,
        },
      });
      leadsCreated++;
    }
  }
  console.log(`✅ Created ${leadsCreated} leads`);

  // Connect some properties to storms
  const properties = await prisma.property.findMany({ take: 10 });
  const recentStorms = await prisma.stormEvent.findMany({
    where: { date: { gte: new Date('2024-01-01') } },
    take: 10,
  });

  let connections = 0;
  for (const property of properties) {
    for (const storm of recentStorms) {
      const stormGeom = storm.geom as { lat?: number; lon?: number } | null;
      if (property.lat && property.lon && stormGeom?.lat && stormGeom?.lon) {
        // Rough distance check (simplified)
        const latDiff = Math.abs(property.lat - stormGeom.lat);
        const lonDiff = Math.abs(property.lon - stormGeom.lon);
        if (latDiff < 0.1 && lonDiff < 0.1) {
          const existing = await prisma.propertyStorm.findUnique({
            where: { propertyId_stormEventId: { propertyId: property.id, stormEventId: storm.id } },
          });
          if (!existing) {
            await prisma.propertyStorm.create({
              data: {
                propertyId: property.id,
                stormEventId: storm.id,
                affected: Math.random() > 0.3, // 70% chance affected
              },
            });
            connections++;
          }
        }
      }
    }
  }
  console.log(`✅ Created ${connections} property-storm connections`);

  console.log('\n🎉 Seed completed!');
  console.log('\nDemo credentials:');
  console.log('  Email: demo@eavesight.com');
  console.log('  Password: demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
