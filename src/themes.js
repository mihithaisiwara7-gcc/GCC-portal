export const THEMES = [
  {
    key: 'premises-map',
    title: 'Proper Maintenance of School Premises and Map',
    shortTitle: 'School Premises & Map',
    icon: '🏫',
    description: 'Evidence, articles and records related to the school premises, grounds and school map.'
  },
  {
    key: 'buildings-infrastructure',
    title: 'Buildings and Infrastructure Facilities are Maintained with Care',
    shortTitle: 'Buildings & Infrastructure',
    icon: '🏗️',
    description: 'Documentation about buildings, infrastructure, maintenance and related facilities.'
  },
  {
    key: 'furniture-equipment',
    title: 'Effective Use and Maintenance of Furniture and Learning Equipment',
    shortTitle: 'Furniture & Learning Equipment',
    icon: '🪑',
    description: 'Records covering furniture, classroom equipment and learning resources.'
  },
  {
    key: 'inventory-stock',
    title: 'Maintain the Inventory Registers and the Stock Book Properly',
    shortTitle: 'Inventory & Stock Book',
    icon: '📦',
    description: 'Evidence related to inventory registers, stock books and asset records.'
  },
  {
    key: 'laboratory',
    title: 'Provision of Laboratory Facilities, and Ensuring Their Effective Use and Maintenance',
    shortTitle: 'Laboratory Facilities',
    icon: '🧪',
    description: 'Laboratory facilities, usage, maintenance and supporting documentation.'
  },
  {
    key: 'library',
    title: 'Effective Utilization and Development of the Library',
    shortTitle: 'Library',
    icon: '📚',
    description: 'Library development, utilization, activities and supporting evidence.'
  },
  {
    key: 'computer-facilities',
    title: 'Effective Use and Maintenance of Computer Facilities',
    shortTitle: 'Computer Facilities',
    icon: '💻',
    description: 'Computer facilities, maintenance, usage and technology-related evidence.'
  },
  {
    key: 'practical-specialized',
    title: 'Effective Utilization and Maintenance of Practical Subjects / Specialized Units',
    shortTitle: 'Practical & Specialized Units',
    icon: '🛠️',
    description: 'Practical subjects, specialized units, workshops and their maintenance.'
  }
];

export const themeByKey = (key) => THEMES.find((theme) => theme.key === key);
